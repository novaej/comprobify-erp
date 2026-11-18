import { schema, sql, type Database } from '@comprobify/db';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { DomainError, requirePermission, type ActorContext } from '../kernel';
import { copyMasterData, type MasterData } from '../masterdata';
import { pairOf } from './pair';

export const resetTwinInput = z.object({
  // The company's RUC, typed: the confirmation the glossary asks for.
  confirmation: z.string().trim(),
});

// PRD glossary, FR-ONB-5 (ADR-043): the test copy emptied of what it did and holds, and refilled
// with the real company's master data, in one transaction. The real company is only read. Owner or
// Admin, from either company of the pair.
export async function resetTwin(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof resetTwinInput>,
): Promise<{ twinTenantId: string; copied: MasterData }> {
  requirePermission(ctx, 'organization.reset_twin');
  const { confirmation } = resetTwinInput.parse(raw);
  return db.withSystem('reset the test copy of a company', async (handle) => {
    const { db: tx } = handle;
    const pair = await pairOf(tx, ctx.tenantId);
    if (!pair.twinTenantId) throw new DomainError('NOT_FOUND', 'This company has no test copy');
    const [real] = await tx
      .select({ ruc: schema.tenants.ruc })
      .from(schema.tenants)
      .where(sql`${schema.tenants.id} = ${pair.realTenantId}`);
    if (confirmation !== real!.ruc)
      throw new DomainError('CONFIRMATION_MISMATCH', 'Type the company’s RUC to confirm');
    // The database refuses anything but a test copy (ADR-043).
    await handle.executeSql('SELECT app_reset_twin($1::uuid)', [pair.twinTenantId]);
    const copied = await copyMasterData(handle, {
      fromTenantId: pair.realTenantId,
      toTenantId: pair.twinTenantId,
    });
    await recordAudit(tx, {
      tenantId: pair.realTenantId,
      actorUserId: ctx.userId ?? null,
      action: 'organization.twin_reset',
      details: { ...copied },
    });
    return { twinTenantId: pair.twinTenantId, copied };
  });
}
