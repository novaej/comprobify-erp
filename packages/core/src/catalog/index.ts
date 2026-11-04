import { and, asc, eq, ilike, or, PRODUCT_KINDS, schema, sql, type Database } from '@comprobify/db';
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
