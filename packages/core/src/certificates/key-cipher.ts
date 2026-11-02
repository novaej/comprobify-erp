import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM for P12 private keys (FR-ONB-3). GCM authenticates, so a wrong
// key or tampered value fails instead of decrypting to garbage. The version
// prefix leaves room to rotate the key without guessing which one wrote a value.
const VERSION = 'v1';

export type KeyCipher = {
  encrypt: (plaintext: string) => string;
  decrypt: (stored: string) => string;
};

export function createKeyCipher(keyHex: string): KeyCipher {
  if (!/^[0-9a-f]{64}$/i.test(keyHex))
    throw new Error('The encryption key must be 64 hex characters');
  const key = Buffer.from(keyHex, 'hex');

  return {
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [
        VERSION,
        iv.toString('hex'),
        cipher.getAuthTag().toString('hex'),
        body.toString('hex'),
      ].join(':');
    },
    decrypt(stored) {
      const [version, iv, tag, body] = stored.split(':');
      if (version !== VERSION || !iv || !tag || !body)
        throw new Error('Unknown encrypted key format');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(tag, 'hex'));
      // Throws on a wrong key or a tampered value.
      return Buffer.concat([decipher.update(Buffer.from(body, 'hex')), decipher.final()]).toString(
        'utf8',
      );
    },
  };
}
