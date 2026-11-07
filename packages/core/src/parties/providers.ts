import { and, asc, eq, ilike, or, schema, sql, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { DomainError, requireFeature, requirePermission, type ActorContext } from '../kernel';
import { clientInput } from './input';

// FR-MD-3: who the company buys from, with the client's identity rules: the same types,
// check digits and payment terms. A company and its twin keep their own lists.
export const providerInput = clientInput;

export type Provider = typeof schema.providers.$inferSelect;

const isUniqueViolation = (error: unknown) => {
  const pgError = error instanceof Error && error.cause ? error.cause : error;
  return (
    typeof pgError === 'object' && pgError !== null && 'code' in pgError && pgError.code === '23505'
  );
};

// Purchasing reads them; managing them is its own permission (PRD section 3).
function canRead(ctx: ActorContext) {
  requireFeature(ctx, 'PROVIDERS');
  requirePermission(ctx, 'purchasing.read');
}
function canManage(ctx: ActorContext) {
  requireFeature(ctx, 'PROVIDERS');
  requirePermission(ctx, 'providers.manage');
}

// Active first by name; a search matches the name or the identification.
export async function listProviders(
  ctx: ActorContext,
  db: Database,
  options: { query?: string; includeInactive?: boolean } = {},
): Promise<Provider[]> {
  canRead(ctx);
  const { providers } = schema;
  const query = options.query?.trim().slice(0, 100);
  const pattern = query ? `%${query.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx
      .select()
      .from(providers)
      .where(
        and(
          options.includeInactive ? undefined : eq(providers.active, true),
          pattern
            ? or(ilike(providers.name, pattern), ilike(providers.identification, pattern))
            : undefined,
        ),
      )
      .orderBy(sql`${providers.active} DESC`, asc(providers.name))
      .limit(200),
  );
}

export async function getProvider(ctx: ActorContext, db: Database, id: string): Promise<Provider> {
  canRead(ctx);
  const providerId = z.uuid().parse(id);
  const [row] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx.select().from(schema.providers).where(eq(schema.providers.id, providerId)),
  );
  if (!row) throw new DomainError('NOT_FOUND', 'Provider not found');
  return row;
}

// The provider of a new purchase order, read inside its transaction.
export async function providerForOrder(
  ctx: ActorContext,
  tx: Tx,
  id: string,
): Promise<Pick<Provider, 'id' | 'idType' | 'identification' | 'name' | 'emails'>> {
  const [row] = await tx.db
    .select()
    .from(schema.providers)
    .where(and(eq(schema.providers.id, id), eq(schema.providers.tenantId, ctx.tenantId)));
  if (!row) throw new DomainError('NOT_FOUND', 'Provider not found');
  if (!row.active) throw new DomainError('PROVIDER_INACTIVE', 'This provider is inactive');
  return row;
}

export async function createProvider(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof providerInput>,
): Promise<Provider> {
  canManage(ctx);
  const input = providerInput.parse(raw);
  try {
    const [row] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
      tx
        .insert(schema.providers)
        .values({ tenantId: ctx.tenantId, ...input })
        .returning(),
    );
    return row!;
  } catch (error) {
    if (isUniqueViolation(error))
      throw new DomainError('IDENTIFICATION_TAKEN', 'A provider with that identification exists');
    throw error;
  }
}

export async function updateProvider(
  ctx: ActorContext,
  db: Database,
  id: string,
  raw: z.input<typeof providerInput>,
): Promise<Provider> {
  canManage(ctx);
  const providerId = z.uuid().parse(id);
  const input = providerInput.parse(raw);
  try {
    const [row] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
      tx
        .update(schema.providers)
        .set({ ...input, updatedAt: sql`now()` })
        .where(eq(schema.providers.id, providerId))
        .returning(),
    );
    if (!row) throw new DomainError('NOT_FOUND', 'Provider not found');
    return row;
  } catch (error) {
    if (isUniqueViolation(error))
      throw new DomainError('IDENTIFICATION_TAKEN', 'A provider with that identification exists');
    throw error;
  }
}

// No hard deletes (rule 12): an inactive provider stays on its orders, off the pickers.
export async function setProviderActive(
  ctx: ActorContext,
  db: Database,
  input: { id: string; active: boolean },
): Promise<void> {
  canManage(ctx);
  const providerId = z.uuid().parse(input.id);
  const updated = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx
      .update(schema.providers)
      .set({ active: input.active, updatedAt: sql`now()` })
      .where(eq(schema.providers.id, providerId))
      .returning({ id: schema.providers.id }),
  );
  if (updated.length === 0) throw new DomainError('NOT_FOUND', 'Provider not found');
}
