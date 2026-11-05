import { eq, schema, type Database } from '@comprobify/db';
import { z } from 'zod';
import { requirePermission, type ActorContext } from '../kernel';

// FR-DOC-6: a key a document had before a re-issue or correction still finds it.
export async function findByAccessKey(
  ctx: ActorContext,
  db: Database,
  key: string,
): Promise<{ documentId: string; current: boolean } | null> {
  requirePermission(ctx, 'documents.read');
  const accessKey = z
    .string()
    .regex(/^\d{49}$/)
    .parse(key);
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const [current] = await tx
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(eq(schema.documents.accessKey, accessKey));
    if (current) return { documentId: current.id, current: true };
    const [previous] = await tx
      .select({ id: schema.documentReissues.documentId })
      .from(schema.documentReissues)
      .where(eq(schema.documentReissues.previousAccessKey, accessKey));
    return previous ? { documentId: previous.id, current: false } : null;
  });
}
