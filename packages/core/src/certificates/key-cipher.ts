import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// AES-256-GCM for P12 private keys (FR-ONB-3). GCM authenticates, so a wrong key or a tampered
// value fails instead of decrypting to garbage.
//
// Rotation (PRD 9.3, ADR-052): a value names the key that wrote it, `v2:<key id>:…`, the id being
// the first 8 hex of the key's SHA-256. The cipher writes with the current key and reads with it or
// the previous one, so a key changes without a moment where a certificate can't be read. `v1:`
// values, written before ids, carry none and are read by trying each key; the tag rejects the wrong
// ones.

export type KeyCipher = {
  encrypt: (plaintext: string) => string;
  decrypt: (stored: string) => string;
  // Written by the current key: nothing for a rotation to redo.
  isCurrent: (stored: string) => boolean;
  // The id of the key that wrote a v2 value; null for v1.
  keyIdOf: (stored: string) => string | null;
  currentKeyId: string;
};

type Key = { id: string; bytes: Buffer };

const keyOf = (keyHex: string): Key => {
  if (!/^[0-9a-f]{64}$/i.test(keyHex))
    throw new Error('The encryption key must be 64 hex characters');
  const bytes = Buffer.from(keyHex, 'hex');
  return { id: createHash('sha256').update(bytes).digest('hex').slice(0, 8), bytes };
};

function open(key: Key, iv: string, tag: string, body: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key.bytes, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  // Throws on a wrong key or a tampered value.
  return Buffer.concat([decipher.update(Buffer.from(body, 'hex')), decipher.final()]).toString(
    'utf8',
  );
}

export function createKeyCipher(currentHex: string, previousHex?: string | null): KeyCipher {
  const current = keyOf(currentHex);
  const previous = previousHex ? keyOf(previousHex) : null;
  if (previous?.id === current.id)
    throw new Error('The previous encryption key is the same as the current one');
  const keys = previous ? [current, previous] : [current];

  const parse = (stored: string) => {
    const parts = stored.split(':');
    if (parts[0] === 'v2' && parts.length === 5) {
      const [, id, iv, tag, body] = parts;
      return { id: id!, iv: iv!, tag: tag!, body: body! };
    }
    if (parts[0] === 'v1' && parts.length === 4) {
      const [, iv, tag, body] = parts;
      return { id: null, iv: iv!, tag: tag!, body: body! };
    }
    throw new Error('Unknown encrypted key format');
  };

  return {
    currentKeyId: current.id,
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', current.bytes, iv);
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [
        'v2',
        current.id,
        iv.toString('hex'),
        cipher.getAuthTag().toString('hex'),
        body.toString('hex'),
      ].join(':');
    },
    decrypt(stored) {
      const { id, iv, tag, body } = parse(stored);
      if (id !== null) {
        const key = keys.find((one) => one.id === id);
        // Named, so a missing CERT_ENCRYPTION_KEY_PREVIOUS is obvious in the error.
        if (!key) throw new Error(`Encrypted with key ${id}, which is not configured`);
        return open(key, iv, tag, body);
      }
      for (const key of keys) {
        try {
          return open(key, iv, tag, body);
        } catch {
          // The next key, if any.
        }
      }
      throw new Error('No configured key opens this value');
    },
    isCurrent: (stored) => parse(stored).id === current.id,
    keyIdOf: (stored) => parse(stored).id,
  };
}
