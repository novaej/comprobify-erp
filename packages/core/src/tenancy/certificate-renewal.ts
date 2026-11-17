import { and, eq, schema, type Database } from '@comprobify/db';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { certificateMatchesRuc, parseP12, type KeyCipher } from '../certificates';
import { DomainError, requirePermission, type ActorContext } from '../kernel';
import { pairOf } from './pair';

const input = z.object({
  file: z.custom<Uint8Array>((value) => value instanceof Uint8Array, 'Expected bytes'),
  password: z.string().max(256),
});

// FR-ONB-3: the new signature replaces the old one, in the company and its test copy together.
// Checked like onboarding's (opens, valid today, belongs to the RUC) before anything is written.
// The old row is switched off, never deleted (CLAUDE.md rule 12); the expiry reminders key on the
// certificate, so the new one starts its own.
export async function replaceCertificate(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof input>,
  deps: { keyCipher: KeyCipher },
): Promise<void> {
  requirePermission(ctx, 'organization.manage');
  const { file, password } = input.parse(raw);
  await db.withSystem('replace the signing certificate of a company and its twin', async (tx) => {
    const pair = await pairOf(tx.db, ctx.tenantId);
    const [tenant] = await tx.db
      .select({ ruc: schema.tenants.ruc })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, pair.realTenantId));
    const parsed = parseP12(file, password, ctx.clock.now());
    if (!certificateMatchesRuc(parsed.identifiers, tenant!.ruc)) {
      throw new DomainError(
        'CERTIFICATE_RUC_MISMATCH',
        'The certificate does not belong to this RUC',
      );
    }
    const stored = {
      encryptedPrivateKey: deps.keyCipher.encrypt(parsed.privateKeyPem),
      certificatePem: parsed.certificatePem,
      fingerprint: parsed.fingerprint,
      subjectName: parsed.subjectName,
      issuerName: parsed.issuerName,
      notBefore: parsed.notBefore,
      notAfter: parsed.notAfter,
    };
    for (const tenantId of [pair.realTenantId, pair.twinTenantId]) {
      if (!tenantId) continue;
      await tx.db
        .update(schema.certificates)
        .set({ active: false })
        .where(
          and(eq(schema.certificates.tenantId, tenantId), eq(schema.certificates.active, true)),
        );
      await tx.db.insert(schema.certificates).values({ tenantId, ...stored });
    }
    await recordAudit(tx.db, {
      tenantId: pair.realTenantId,
      actorUserId: ctx.userId ?? null,
      action: 'certificate.uploaded',
      details: {
        fingerprint: parsed.fingerprint,
        issuerName: parsed.issuerName,
        notAfter: parsed.notAfter.toISOString(),
        renewed: true,
      },
    });
  });
}
