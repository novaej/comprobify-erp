import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptLegacyValue } from './input';

// ADR-049: the previous system's '<iv>:<tag>:<ciphertext>' AES-256-GCM values.
describe('the previous system’s encrypted values', () => {
  const key = randomBytes(32).toString('hex');
  const encrypt = (plaintext: string) => {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map((part) => part.toString('hex')).join(':');
  };

  it('decrypts with the right key and fails loud with another', () => {
    const stored = encrypt('-----BEGIN RSA PRIVATE KEY-----');
    expect(decryptLegacyValue(stored, key)).toBe('-----BEGIN RSA PRIVATE KEY-----');
    expect(() => decryptLegacyValue(stored, 'ab'.repeat(32))).toThrow();
    expect(() => decryptLegacyValue('not:a value', key)).toThrow();
    expect(() => decryptLegacyValue(stored, 'short')).toThrow('64 hex');
  });
});
