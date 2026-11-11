import { eq, schema, type Database } from '@comprobify/db';
import { recordPlatformAudit } from '../audit';
import { documentForSupport, type SupportDocument } from '../documents';
import { assertSuperAdmin } from '../identity';
import type { PlatformActor } from '../kernel';
import { companyRow } from '../tenancy';

// FR-DOC-13, FR-ADM-1: what SRI answered to each call for one document, for support. Across
// companies, in system context; opening one is recorded in the platform log, since it reads a
// company's documents.
export type ExchangesView = SupportDocument & {
  company: string;
  // The document is the test copy's, not the real company's.
  isTwin: boolean;
};

export async function documentExchanges(
  actor: PlatformActor,
  db: Database,
  accessKey: string,
): Promise<ExchangesView | null> {
  await assertSuperAdmin(db.identity, actor);
  return db.withSystem('super admin: read the SRI exchanges of a document', async ({ db: tx }) => {
    const document = await documentForSupport(tx, accessKey);
    if (!document) return null;
    const [tenant] = await tx
      .select({ id: schema.tenants.id, twinOf: schema.tenants.twinOf })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, document.tenantId));
    const company = await companyRow(tx, tenant!.twinOf ?? tenant!.id);
    await recordPlatformAudit(tx, {
      actorUserId: actor.userId,
      action: 'document.exchanges_viewed',
      details: { documentId: document.id, tenantId: document.tenantId },
    });
    return { ...document, company: company.name, isTwin: tenant!.twinOf !== null };
  });
}
