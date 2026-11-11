import {
  and,
  asc,
  CLIENT_ID_TYPES,
  eq,
  ilike,
  or,
  schema,
  sql,
  type Database,
  type Tx,
} from '@comprobify/db';
import { z } from 'zod';
import { DomainError, requireFeature, requirePermission, type ActorContext } from '../kernel';
import { clientInput, line } from './input';

export { isValidCedula, isValidIdentification } from './identification';
export { CLIENT_ID_TYPES };
export { clientInput } from './input';
export { CLIENT_IMPORT_MAX_ROWS, exportClients, importClients } from './clients-import';
export type { ClientImportResult } from './clients-import';
export {
  createProvider,
  getProvider,
  listProviders,
  providerForOrder,
  providerInput,
  setProviderActive,
  updateProvider,
} from './providers';
export type { Provider } from './providers';

// FR-MD-2: the company's clients. Consumidor final is built in, never a row; a company
// and its twin keep their own lists.

export type Client = typeof schema.clients.$inferSelect;

const isUniqueViolation = (error: unknown) => {
  const pgError = error instanceof Error && error.cause ? error.cause : error;
  return (
    typeof pgError === 'object' && pgError !== null && 'code' in pgError && pgError.code === '23505'
  );
};

function canRead(ctx: ActorContext) {
  requireFeature(ctx, 'CLIENTS');
  requirePermission(ctx, 'clients.read');
}
function canManage(ctx: ActorContext) {
  requireFeature(ctx, 'CLIENTS');
  requirePermission(ctx, 'clients.manage');
}

// Active first by name; a search matches the name or the identification.
export async function listClients(
  ctx: ActorContext,
  db: Database,
  options: { query?: string; includeInactive?: boolean } = {},
): Promise<Client[]> {
  canRead(ctx);
  const { clients } = schema;
  const query = options.query?.trim().slice(0, 100);
  const pattern = query ? `%${query.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx
      .select()
      .from(clients)
      .where(
        and(
          options.includeInactive ? undefined : eq(clients.active, true),
          pattern
            ? or(ilike(clients.name, pattern), ilike(clients.identification, pattern))
            : undefined,
        ),
      )
      .orderBy(sql`${clients.active} DESC`, asc(clients.name))
      .limit(200),
  );
}

// What an invoice may change on its client, from the form (FR-MD-2): never the
// identification, which would make it another client.
export const buyerChangesInput = z.object({
  name: line(300),
  emails: z.array(z.email().max(254).toLowerCase()).max(5),
  phone: line(30).nullable(),
  address: line(300).nullable(),
});
export type BuyerChanges = z.input<typeof buyerChangesInput>;

// Inside the invoice's transaction, so the client and the document change together.
export async function updateBuyerDetails(
  ctx: ActorContext,
  tx: Tx,
  id: string,
  raw: BuyerChanges,
): Promise<void> {
  canManage(ctx);
  const changes = buyerChangesInput.parse(raw);
  const [row] = await tx.db
    .update(schema.clients)
    .set({ ...changes, updatedAt: sql`now()` })
    .where(and(eq(schema.clients.id, id), eq(schema.clients.tenantId, ctx.tenantId)))
    .returning({ id: schema.clients.id });
  if (!row) throw new DomainError('NOT_FOUND', 'Client not found');
}

// The buyer of a new document, read inside its transaction. Issuing needs only
// documents.issue: the plan losing CLIENTS keeps existing clients usable (FR-PLAN-3).
export async function buyerForDocument(
  ctx: ActorContext,
  tx: Tx,
  id: string,
): Promise<Pick<Client, 'idType' | 'identification' | 'name' | 'address' | 'emails'>> {
  const [row] = await tx.db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, id), eq(schema.clients.tenantId, ctx.tenantId)));
  if (!row) throw new DomainError('NOT_FOUND', 'Client not found');
  if (!row.active) throw new DomainError('CLIENT_INACTIVE', 'This client is inactive');
  return row;
}

export async function getClient(ctx: ActorContext, db: Database, id: string): Promise<Client> {
  canRead(ctx);
  const clientId = z.uuid().parse(id);
  const [row] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx.select().from(schema.clients).where(eq(schema.clients.id, clientId)),
  );
  if (!row) throw new DomainError('NOT_FOUND', 'Client not found');
  return row;
}

export async function createClient(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof clientInput>,
): Promise<Client> {
  canManage(ctx);
  const input = clientInput.parse(raw);
  try {
    const [row] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
      tx
        .insert(schema.clients)
        .values({ tenantId: ctx.tenantId, ...input })
        .returning(),
    );
    return row!;
  } catch (error) {
    if (isUniqueViolation(error))
      throw new DomainError('IDENTIFICATION_TAKEN', 'A client with that identification exists');
    throw error;
  }
}

export async function updateClient(
  ctx: ActorContext,
  db: Database,
  id: string,
  raw: z.input<typeof clientInput>,
): Promise<Client> {
  canManage(ctx);
  const clientId = z.uuid().parse(id);
  const input = clientInput.parse(raw);
  try {
    const [row] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
      tx
        .update(schema.clients)
        .set({ ...input, updatedAt: sql`now()` })
        .where(eq(schema.clients.id, clientId))
        .returning(),
    );
    if (!row) throw new DomainError('NOT_FOUND', 'Client not found');
    return row;
  } catch (error) {
    if (isUniqueViolation(error))
      throw new DomainError('IDENTIFICATION_TAKEN', 'A client with that identification exists');
    throw error;
  }
}

// No hard deletes (rule 12): an inactive client stays on its documents, off the pickers.
export async function setClientActive(
  ctx: ActorContext,
  db: Database,
  input: { id: string; active: boolean },
): Promise<void> {
  canManage(ctx);
  const clientId = z.uuid().parse(input.id);
  const updated = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx
      .update(schema.clients)
      .set({ active: input.active, updatedAt: sql`now()` })
      .where(eq(schema.clients.id, clientId))
      .returning({ id: schema.clients.id }),
  );
  if (updated.length === 0) throw new DomainError('NOT_FOUND', 'Client not found');
}
