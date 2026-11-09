import { and, eq, schema, sql, type Tx } from '@comprobify/db';

// FR-ONB-5: at go-live a company can copy its master data from its test twin to the real
// organization: products, clients, providers and invoice templates, never transactions. One
// way, once. It runs in the go-live transaction, in system context, with both tenants named.

export type MasterData = {
  products: number;
  clients: number;
  providers: number;
  templates: number;
};

// What a copy would take: the active rows of the twin.
export async function countMasterData(tx: Tx, tenantId: string): Promise<MasterData> {
  const { products, clients, providers, documentTemplates } = schema;
  const count = async (table: typeof products | typeof clients | typeof providers) => {
    const [row] = await tx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(and(eq(table.tenantId, tenantId), eq(table.active, true)));
    return row!.n;
  };
  const [templates] = await tx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(documentTemplates)
    .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.active, true)));
  return {
    products: await count(products),
    clients: await count(clients),
    providers: await count(providers),
    templates: templates!.n,
  };
}

const withoutIdentity = <
  T extends { id: string; tenantId: string; createdAt: Date; updatedAt: Date },
>(
  row: T,
) => {
  const { id: _id, tenantId: _tenant, createdAt: _created, updatedAt: _updated, ...rest } = row;
  void [_id, _tenant, _created, _updated];
  return rest;
};

// Copies what the real organization doesn't already have, so a company that began entering data
// there first keeps it; a row that clashes with one there (the same code or identification)
// is left alone. Returns how many rows each kind added.
export async function copyMasterData(
  tx: Tx,
  ids: { fromTenantId: string; toTenantId: string },
): Promise<MasterData> {
  const { products, clients, providers, documentTemplates } = schema;
  const { fromTenantId, toTenantId } = ids;

  const sourceProducts = await tx.db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, fromTenantId), eq(products.active, true)));
  const addedProducts = sourceProducts.length
    ? await tx.db
        .insert(products)
        .values(sourceProducts.map((row) => ({ ...withoutIdentity(row), tenantId: toTenantId })))
        .onConflictDoNothing()
        .returning({ id: products.id })
    : [];
  // Which real product stands for each of the twin's, by code, for the templates below.
  const realProducts = new Map(
    (await tx.db.select().from(products).where(eq(products.tenantId, toTenantId))).map((row) => [
      row.code,
      row.id,
    ]),
  );
  const productIds = new Map(
    sourceProducts.flatMap((row) => {
      const real = realProducts.get(row.code);
      return real ? [[row.id, real] as const] : [];
    }),
  );

  const sourceClients = await tx.db
    .select()
    .from(clients)
    .where(and(eq(clients.tenantId, fromTenantId), eq(clients.active, true)));
  const addedClients = sourceClients.length
    ? await tx.db
        .insert(clients)
        .values(sourceClients.map((row) => ({ ...withoutIdentity(row), tenantId: toTenantId })))
        .onConflictDoNothing()
        .returning({ id: clients.id })
    : [];
  const realClients = new Map(
    (await tx.db.select().from(clients).where(eq(clients.tenantId, toTenantId))).map((row) => [
      `${row.idType}:${row.identification}`,
      row.id,
    ]),
  );
  const clientIds = new Map(
    sourceClients.flatMap((row) => {
      const real = realClients.get(`${row.idType}:${row.identification}`);
      return real ? [[row.id, real] as const] : [];
    }),
  );

  const sourceProviders = await tx.db
    .select()
    .from(providers)
    .where(and(eq(providers.tenantId, fromTenantId), eq(providers.active, true)));
  const addedProviders = sourceProviders.length
    ? await tx.db
        .insert(providers)
        .values(sourceProviders.map((row) => ({ ...withoutIdentity(row), tenantId: toTenantId })))
        .onConflictDoNothing()
        .returning({ id: providers.id })
    : [];

  // A template points at a client and products of the twin; it is moved to the copies of them.
  const sourceTemplates = await tx.db
    .select()
    .from(documentTemplates)
    .where(and(eq(documentTemplates.tenantId, fromTenantId), eq(documentTemplates.active, true)));
  const moved = sourceTemplates.map((row) => {
    const content: Record<string, unknown> = { ...row.content };
    if (typeof content.clientId === 'string')
      content.clientId = clientIds.get(content.clientId) ?? null;
    if (Array.isArray(content.lines))
      content.lines = (content.lines as Record<string, unknown>[]).map((line) => ({
        ...line,
        productId:
          typeof line.productId === 'string' ? (productIds.get(line.productId) ?? null) : null,
      }));
    return { ...withoutIdentity(row), tenantId: toTenantId, createdBy: null, content };
  });
  const addedTemplates = moved.length
    ? await tx.db
        .insert(documentTemplates)
        .values(moved)
        .onConflictDoNothing()
        .returning({ id: documentTemplates.id })
    : [];

  return {
    products: addedProducts.length,
    clients: addedClients.length,
    providers: addedProviders.length,
    templates: addedTemplates.length,
  };
}
