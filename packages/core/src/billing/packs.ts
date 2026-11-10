import { and, asc, eq, schema, sql, type Tx } from '@comprobify/db';
import { DomainError } from '../kernel';

// FR-BILL-7: document packs, in the real company. Bought once, spent one document at a time after
// the period's quota, oldest first, and carried from period to period until used up.

// A verified pack payment: its documents are available at once.
export async function grantPack(
  tx: Tx['db'],
  payment: { tenantId: string; id: string; packSize: number | null },
): Promise<void> {
  await tx
    .insert(schema.documentPacks)
    .values({ tenantId: payment.tenantId, paymentId: payment.id, size: payment.packSize! });
}

// Only a pack with nothing spent goes back with its money: a used document was issued.
export async function refundPack(tx: Tx['db'], paymentId: string): Promise<void> {
  const { documentPacks } = schema;
  const [pack] = await tx
    .select()
    .from(documentPacks)
    .where(eq(documentPacks.paymentId, paymentId))
    .for('update');
  if (!pack) throw new Error(`Pack payment ${paymentId} has no pack`);
  if (pack.used > 0)
    throw new DomainError('PACK_IN_USE', 'Part of this pack is already used', {
      used: pack.used,
    });
  await tx.update(documentPacks).set({ status: 'REFUNDED' }).where(eq(documentPacks.id, pack.id));
}

// One document beyond the quota, from the oldest pack with any left. The caller holds the quota
// lock, so two documents never take the same one. False when nothing is left.
export async function consumePack(tx: Tx['db'], tenantId: string): Promise<boolean> {
  const { documentPacks } = schema;
  const [pack] = await tx
    .select({ id: documentPacks.id })
    .from(documentPacks)
    .where(
      and(
        eq(documentPacks.tenantId, tenantId),
        eq(documentPacks.status, 'ACTIVE'),
        sql`${documentPacks.used} < ${documentPacks.size}`,
      ),
    )
    .orderBy(asc(documentPacks.createdAt), asc(documentPacks.id))
    .limit(1)
    .for('update');
  if (!pack) return false;
  await tx
    .update(documentPacks)
    .set({ used: sql`${documentPacks.used} + 1` })
    .where(eq(documentPacks.id, pack.id));
  return true;
}

// Documents left in the company's packs.
export async function packBalance(tx: Tx['db'], tenantId: string): Promise<number> {
  const { documentPacks } = schema;
  const [row] = await tx
    .select({
      left: sql<number>`coalesce(sum(${documentPacks.size} - ${documentPacks.used}), 0)::int`,
    })
    .from(documentPacks)
    .where(and(eq(documentPacks.tenantId, tenantId), eq(documentPacks.status, 'ACTIVE')));
  return row!.left;
}
