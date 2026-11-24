import { eq, inArray, schema, type Database } from '@comprobify/db';
import type { KeyCipher } from '../certificates';

// ADR-052, PRD 9.3: after CERT_ENCRYPTION_KEY changes (with the old one as
// CERT_ENCRYPTION_KEY_PREVIOUS), every stored certificate key is written again under the new one,
// in every company and test copy, active or not. One transaction: all or none. Running it again
// changes nothing.
export type CertificateKeyReport = {
  total: number;
  reencrypted: number;
  // How many each key id held before, `v1` for values from before key ids.
  byKey: Record<string, number>;
};

export async function rotateCertificateKeys(
  db: Database,
  keyCipher: KeyCipher,
  // `tenantIds` limits the run to those companies; the command always runs on every one.
  options: { commit: boolean; tenantIds?: string[] },
): Promise<CertificateKeyReport> {
  return db.withSystem(
    're-encrypt the stored certificate keys under the current key',
    async ({ db: tx }) => {
      const { certificates } = schema;
      const rows = await tx
        .select({ id: certificates.id, stored: certificates.encryptedPrivateKey })
        .from(certificates)
        .where(options.tenantIds ? inArray(certificates.tenantId, options.tenantIds) : undefined)
        .for('update');
      const byKey: Record<string, number> = {};
      let reencrypted = 0;
      for (const row of rows) {
        const id = keyCipher.keyIdOf(row.stored) ?? 'v1';
        byKey[id] = (byKey[id] ?? 0) + 1;
        if (keyCipher.isCurrent(row.stored)) continue;
        // Throws when no configured key opens it, which rolls the whole run back.
        const plaintext = keyCipher.decrypt(row.stored);
        if (options.commit)
          await tx
            .update(certificates)
            .set({ encryptedPrivateKey: keyCipher.encrypt(plaintext) })
            .where(eq(certificates.id, row.id));
        reencrypted += 1;
      }
      return { total: rows.length, reencrypted, byKey };
    },
  );
}
