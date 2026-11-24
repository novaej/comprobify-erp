import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTestP12, testRuc } from '../testing';
import { certificateMatchesRuc, createKeyCipher, parseP12 } from '.';

const now = new Date();

describe('parseP12 (FR-ONB-3)', () => {
  const ruc = testRuc();
  const file = createTestP12({ ruc, password: 'clave segura' });

  it('extracts the key, certificate, fingerprint, dates and identifiers', () => {
    const parsed = parseP12(file, 'clave segura', now);
    expect(parsed.privateKeyPem).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/);
    expect(parsed.certificatePem).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(parsed.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed).toMatchObject({ subjectName: 'ANA PEREZ', issuerName: 'TEST CA S.A.' });
    expect(parsed.identifiers).toContain(ruc);
  });

  it('picks the signing certificate, not the CA in the chain', () => {
    expect(parseP12(file, 'clave segura', now).subjectName).toBe('ANA PEREZ');
  });

  it.each([
    ['a wrong password', () => parseP12(file, 'otra', now), 'CERTIFICATE_PASSWORD_INVALID'],
    [
      'a file that is not a P12',
      () => parseP12(Buffer.from('hello'), '', now),
      'CERTIFICATE_INVALID',
    ],
    [
      'an expired certificate',
      () =>
        parseP12(
          createTestP12({
            ruc,
            notBefore: new Date('2020-01-01'),
            notAfter: new Date('2021-01-01'),
          }),
          'secret',
          now,
        ),
      'CERTIFICATE_EXPIRED',
    ],
  ])('refuses %s with a stable code', (_, parse, code) => {
    expect(parse).toThrow(expect.objectContaining({ code }) as Error);
  });
});

describe('certificateMatchesRuc', () => {
  it('matches the RUC itself', () => {
    expect(certificateMatchesRuc(['1790011223001'], '1790011223001')).toBe(true);
  });

  it("matches a person's cédula, the RUC's first ten digits", () => {
    expect(certificateMatchesRuc(['1712345678'], '1712345678001')).toBe(true);
  });

  it('never matches a company by a ten-digit prefix', () => {
    expect(certificateMatchesRuc(['1790011223'], '1790011223001')).toBe(false);
  });

  it('refuses a certificate for another RUC', () => {
    expect(certificateMatchesRuc(['1712345678001'], '1799999999001')).toBe(false);
  });
});

describe('key cipher', () => {
  const key = 'a'.repeat(64);

  it('round-trips, with a fresh IV every time', () => {
    const cipher = createKeyCipher(key);
    const first = cipher.encrypt('private key');
    expect(first).toMatch(/^v2:[0-9a-f]{8}:/);
    expect(cipher.keyIdOf(first)).toBe(cipher.currentKeyId);
    expect(cipher.encrypt('private key')).not.toBe(first);
    expect(cipher.decrypt(first)).toBe('private key');
  });

  it('refuses a tampered value or the wrong key', () => {
    const stored = createKeyCipher(key).encrypt('private key');
    const tampered = stored.slice(0, -2) + (stored.endsWith('00') ? '11' : '00');
    expect(() => createKeyCipher(key).decrypt(tampered)).toThrow();
    expect(() => createKeyCipher('b'.repeat(64)).decrypt(stored)).toThrow();
  });

  it('refuses a key that is not 64 hex characters', () => {
    expect(() => createKeyCipher('short')).toThrow(/64 hex/);
  });

  // ADR-052: rotating the key.
  const older = 'c'.repeat(64);
  // What the cipher wrote before key ids: 'v1:<iv>:<tag>:<body>'.
  const v1 = (keyHex: string, plaintext: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('hex'),
      cipher.getAuthTag().toString('hex'),
      body.toString('hex'),
    ].join(':');
  };

  it('reads with the current or the previous key, and writes with the current one', () => {
    const before = createKeyCipher(older).encrypt('private key');
    const rotating = createKeyCipher(key, older);
    expect(rotating.decrypt(before)).toBe('private key');
    expect(rotating.isCurrent(before)).toBe(false);
    const after = rotating.encrypt('private key');
    expect(rotating.isCurrent(after)).toBe(true);
    // Once the previous key is gone, what it wrote names it.
    expect(() => createKeyCipher(key).decrypt(before)).toThrow(
      `Encrypted with key ${createKeyCipher(older).currentKeyId}`,
    );
    expect(createKeyCipher(key).decrypt(after)).toBe('private key');
  });

  it('reads values from before key ids with either key', () => {
    const old = v1(older, 'private key');
    const rotating = createKeyCipher(key, older);
    expect(rotating.decrypt(old)).toBe('private key');
    expect(rotating.isCurrent(old)).toBe(false);
    expect(rotating.keyIdOf(old)).toBeNull();
    expect(createKeyCipher(older).decrypt(old)).toBe('private key');
    expect(() => createKeyCipher(key).decrypt(old)).toThrow('No configured key');
  });

  it('refuses the same key as current and previous', () => {
    expect(() => createKeyCipher(key, key)).toThrow(/same/);
  });
});
