import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  or,
  PRODUCT_KINDS,
  schema,
  sql,
  type Database,
  type Tx,
} from '@comprobify/db';
import { z } from 'zod';
import {
  DomainError,
  preciseInput,
  requireFeature,
  requirePermission,
  type ActorContext,
} from '../kernel';
import { SELECTABLE_IVA_RATES } from '../sri';

export { PRODUCT_KINDS };

// FR-MD-1: the company's products and services. A company and its twin keep their own.

// SRI's text fields refuse newlines; lengths are the factura XSD's (ADR-012).
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\n\r\t]*$/);

export const productInput = z.object({
  code: line(25),
  auxiliaryCode: line(25).nullable().default(null),
  name: line(300),
  description: z.string().trim().max(1000).nullable().default(null),
  kind: z.enum(PRODUCT_KINDS),
  unit: line(50).nullable().default(null),
  price: preciseInput,
  cost: preciseInput.nullable().default(null),
  // Only today's rates (ADR-012); the historical ones stay readable on old rows.
  ivaRateCode: z.enum(SELECTABLE_IVA_RATES as [string, ...string[]]),
  tracksStock: z.boolean().default(false),
  // FR-DOC-9: at most three, up to 300 characters, no tabs or newlines.
  additionalDetails: z
    .array(z.object({ name: line(300), value: line(300) }))
    .max(3)
    .default([]),
});

export type Product = typeof schema.products.$inferSelect;

const isUniqueViolation = (error: unknown) => {
  const pgError = error instanceof Error && error.cause ? error.cause : error;
  return (
    typeof pgError === 'object' && pgError !== null && 'code' in pgError && pgError.code === '23505'
  );
};

// The products trigger refuses to stop tracking stock a warehouse still holds (FR-INV-6).
export const isStockHeld = (error: unknown) => {
  const pgError = error instanceof Error && error.cause ? error.cause : error;
  return pgError instanceof Error && pgError.message.startsWith('STOCK_HELD');
};

// Only goods have stock.
function checkKind(input: z.output<typeof productInput>) {
  if (input.kind === 'SERVICE' && input.tracksStock)
    throw new DomainError('SERVICE_HAS_NO_STOCK', 'A service does not track stock');
}

function canRead(ctx: ActorContext) {
  requireFeature(ctx, 'CATALOG');
  requirePermission(ctx, 'catalog.read');
}
function canManage(ctx: ActorContext) {
  requireFeature(ctx, 'CATALOG');
  requirePermission(ctx, 'catalog.manage');
}

// Active first by name; a search matches the name or either code.
export async function listProducts(
  ctx: ActorContext,
  db: Database,
  options: { query?: string; includeInactive?: boolean } = {},
): Promise<Product[]> {
  canRead(ctx);
  const { products } = schema;
  const query = options.query?.trim().slice(0, 100);
  const pattern = query ? `%${query.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx
      .select()
      .from(products)
      .where(
        and(
          options.includeInactive ? undefined : eq(products.active, true),
          pattern
            ? or(
                ilike(products.name, pattern),
                ilike(products.code, pattern),
                ilike(products.auxiliaryCode, pattern),
              )
            : undefined,
        ),
      )
      .orderBy(sql`${products.active} DESC`, asc(products.name))
      .limit(200),
  );
}

export async function getProduct(ctx: ActorContext, db: Database, id: string): Promise<Product> {
  canRead(ctx);
  const productId = z.uuid().parse(id);
  const [row] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx.select().from(schema.products).where(eq(schema.products.id, productId)),
  );
  if (!row) throw new DomainError('NOT_FOUND', 'Product not found');
  return row;
}

export async function createProduct(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof productInput>,
): Promise<Product> {
  canManage(ctx);
  const input = productInput.parse(raw);
  checkKind(input);
  try {
    const [row] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
      tx
        .insert(schema.products)
        .values({ tenantId: ctx.tenantId, ...input })
        .returning(),
    );
    return row!;
  } catch (error) {
    if (isUniqueViolation(error))
      throw new DomainError('CODE_TAKEN', 'A product with that code exists');
    throw error;
  }
}

export async function updateProduct(
  ctx: ActorContext,
  db: Database,
  id: string,
  raw: z.input<typeof productInput>,
): Promise<Product> {
  canManage(ctx);
  const productId = z.uuid().parse(id);
  const input = productInput.parse(raw);
  checkKind(input);
  try {
    const [row] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
      tx
        .update(schema.products)
        .set({ ...input, updatedAt: sql`now()` })
        .where(eq(schema.products.id, productId))
        .returning(),
    );
    if (!row) throw new DomainError('NOT_FOUND', 'Product not found');
    return row;
  } catch (error) {
    if (isUniqueViolation(error))
      throw new DomainError('CODE_TAKEN', 'A product with that code exists');
    if (isStockHeld(error))
      throw new DomainError('STOCK_HELD', 'The product still has stock in a warehouse');
    throw error;
  }
}

// No hard deletes (rule 12): an inactive product stays on its documents, off the pickers.
export async function setProductActive(
  ctx: ActorContext,
  db: Database,
  input: { id: string; active: boolean },
): Promise<void> {
  canManage(ctx);
  const productId = z.uuid().parse(input.id);
  const updated = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx
      .update(schema.products)
      .set({ active: input.active, updatedAt: sql`now()` })
      .where(eq(schema.products.id, productId))
      .returning({ id: schema.products.id }),
  );
  if (updated.length === 0) throw new DomainError('NOT_FOUND', 'Product not found');
}

// FR-INV-6: a product whose stock may move, read in the caller's transaction. Only a good
// that tracks stock has a level.
export async function stockedProduct(
  tx: Tx,
  productId: string,
): Promise<{ id: string; cost: string | null }> {
  const [row] = await tx.db
    .select({
      id: schema.products.id,
      kind: schema.products.kind,
      tracksStock: schema.products.tracksStock,
      cost: schema.products.cost,
    })
    .from(schema.products)
    .where(eq(schema.products.id, productId));
  if (!row) throw new DomainError('NOT_FOUND', 'Product not found');
  if (row.kind !== 'GOOD' || !row.tracksStock)
    throw new DomainError('PRODUCT_NOT_STOCKED', 'This product does not track stock');
  return { id: row.id, cost: row.cost };
}

// Which of these products are goods that track stock, read in the caller's transaction.
export async function stockedAmong(tx: Tx, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { products } = schema;
  const rows = await tx.db
    .select({ id: products.id })
    .from(products)
    .where(
      and(inArray(products.id, ids), eq(products.kind, 'GOOD'), eq(products.tracksStock, true)),
    );
  return new Set(rows.map((row) => row.id));
}

// Products by code for an import, read in the caller's transaction.
export async function productsByCode(
  tx: Tx,
  codes: string[],
): Promise<{ id: string; code: string; kind: string; tracksStock: boolean }[]> {
  if (codes.length === 0) return [];
  return tx.db
    .select({
      id: schema.products.id,
      code: schema.products.code,
      kind: schema.products.kind,
      tracksStock: schema.products.tracksStock,
    })
    .from(schema.products)
    .where(inArray(schema.products.code, codes));
}

export type StockedProduct = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  active: boolean;
};

// FR-INV-6: the goods that track stock, a page at a time by name, for the inventory screens.
export async function stockedProducts(
  tx: Tx,
  options: { query?: string; ids?: string[]; offset: number; limit: number },
): Promise<{ rows: StockedProduct[]; total: number }> {
  const { products } = schema;
  const query = options.query?.trim().slice(0, 100);
  const pattern = query ? `%${query.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const where = and(
    eq(products.kind, 'GOOD'),
    eq(products.tracksStock, true),
    options.ids ? inArray(products.id, options.ids) : undefined,
    pattern ? or(ilike(products.name, pattern), ilike(products.code, pattern)) : undefined,
  );
  const [count] = await tx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(products)
    .where(where);
  const rows = await tx.db
    .select({
      id: products.id,
      code: products.code,
      name: products.name,
      unit: products.unit,
      active: products.active,
    })
    .from(products)
    .where(where)
    .orderBy(sql`${products.active} DESC`, asc(products.name), asc(products.id))
    .limit(options.limit)
    .offset(options.offset);
  return { rows, total: count!.total };
}

// One product's name and whether it tracks stock, for its inventory page.
export async function productSummary(
  tx: Tx,
  productId: string,
): Promise<(StockedProduct & { tracksStock: boolean; kind: string }) | null> {
  const [row] = await tx.db
    .select({
      id: schema.products.id,
      code: schema.products.code,
      name: schema.products.name,
      unit: schema.products.unit,
      active: schema.products.active,
      tracksStock: schema.products.tracksStock,
      kind: schema.products.kind,
    })
    .from(schema.products)
    .where(eq(schema.products.id, productId));
  return row ?? null;
}

export type OrderProduct = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  kind: string;
  tracksStock: boolean;
  ivaRateCode: string;
  active: boolean;
};

// The products on a purchase order, read in its transaction (FR-PUR-1).
export async function productsForOrder(tx: Tx, ids: string[]): Promise<OrderProduct[]> {
  if (ids.length === 0) return [];
  const { products } = schema;
  return tx.db
    .select({
      id: products.id,
      code: products.code,
      name: products.name,
      unit: products.unit,
      kind: products.kind,
      tracksStock: products.tracksStock,
      ivaRateCode: products.ivaRateCode,
      active: products.active,
    })
    .from(products)
    .where(inArray(products.id, ids));
}
export { exportProducts, importProducts, PRODUCT_IMPORT_MAX_ROWS } from './import';
export type { ProductImportResult } from './import';

// What a CSV invoice batch needs of each product it names: the price and rate to bill and whether
// it can be sold at all. Read in the caller's transaction.
export type SellableProduct = {
  id: string;
  code: string;
  auxiliaryCode: string | null;
  name: string;
  unit: string | null;
  price: string;
  ivaRateCode: string;
  active: boolean;
};

export async function productsToSell(tx: Tx, codes: string[]): Promise<SellableProduct[]> {
  if (codes.length === 0) return [];
  return tx.db
    .select({
      id: schema.products.id,
      code: schema.products.code,
      auxiliaryCode: schema.products.auxiliaryCode,
      name: schema.products.name,
      unit: schema.products.unit,
      price: schema.products.price,
      ivaRateCode: schema.products.ivaRateCode,
      active: schema.products.active,
    })
    .from(schema.products)
    .where(inArray(schema.products.code, codes));
}
