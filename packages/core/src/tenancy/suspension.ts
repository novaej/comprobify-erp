import { inArray, schema, sql, SUSPENSION_REASONS, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { DomainError } from '../kernel';

// FR-BILL-9: the operator suspends a company, which keeps reading its data and nothing else
// (the write block in requirePermission). Written in the company and its twin alike, in the
// caller's system-context transaction; a trigger refuses it anywhere else.

export const suspendInput = z.object({
  reason: z.enum(SUSPENSION_REASONS),
  note: z.string().trim().min(3).max(300).nullable().default(null),
});

type Company = { realTenantId: string; twinTenantId: string };

async function setSuspension(
  tx: Tx['db'],
  company: Company,
  suspend: { reason: (typeof SUSPENSION_REASONS)[number]; at: Date } | null,
): Promise<void> {
  const { tenants } = schema;
  const [real] = await tx
    .select({ status: tenants.status })
    .from(tenants)
    .where(inArray(tenants.id, [company.realTenantId]))
    .for('update');
  if (!real) throw new DomainError('NOT_FOUND', 'Company not found');
  if (suspend && real.status === 'SUSPENDED')
    throw new DomainError('ALREADY_SUSPENDED', 'The company is already suspended');
  if (!suspend && real.status !== 'SUSPENDED')
    throw new DomainError('NOT_SUSPENDED', 'The company is not suspended');
  await tx
    .update(tenants)
    .set({
      status: suspend ? 'SUSPENDED' : 'ACTIVE',
      suspensionReason: suspend?.reason ?? null,
      suspendedAt: suspend?.at ?? null,
      updatedAt: sql`now()`,
    })
    .where(inArray(tenants.id, [company.realTenantId, company.twinTenantId]));
}

export async function applySuspension(
  tx: Tx['db'],
  company: Company,
  raw: z.input<typeof suspendInput>,
  now: Date,
): Promise<z.output<typeof suspendInput>> {
  const input = suspendInput.parse(raw);
  await setSuspension(tx, company, { reason: input.reason, at: now });
  return input;
}

export const applyReactivation = (tx: Tx['db'], company: Company) =>
  setSuspension(tx, company, null);
