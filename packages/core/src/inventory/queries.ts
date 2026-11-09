import { and, asc, desc, eq, inArray, schema, sql, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { productSummary, stockedProducts, type StockedProduct } from '../catalog';
import {
  Dec,
  DomainError,
  requireFeature,
  requirePermission,
  toSriAmount,
  type ActorContext,
} from '../kernel';
import { negativeStockRule, warehousesOf, type Warehouse } from '../tenancy';

// The inventory screens' reads (FR-INV-2, FR-INV-5). Quantities and costs stay decimal
// strings; values are shown to the cent.

function canRead(ctx: ActorContext) {
  requireFeature(ctx, 'INVENTORY');
  requirePermission(ctx, 'inventory.read');
}

export type StockFigures = {
  onHand: string;
  reserved: string;
  available: string;
  averageCost: string;
  value: string;
};

type Level = typeof schema.stockLevels.$inferSelect;

// Several warehouses add up; the average of the sum is its value over its quantity.
function figures(levels: Level[]): StockFigures {
  const sum = (pick: (level: Level) => string) =>
    levels.reduce((total, level) => total.add(pick(level)), new Dec(0));
  const onHand = sum((level) => level.onHand);
  const reserved = sum((level) => level.reserved);
  const value = sum((level) => level.value);
  const averageCost =
    levels.length === 1
      ? new Dec(levels[0]!.averageCost)
      : onHand.gt(0)
        ? value.div(onHand).toDecimalPlaces(6)
        : new Dec(levels[0]?.averageCost ?? 0);
  return {
    onHand: onHand.toString(),
    reserved: reserved.toString(),
    available: onHand.sub(reserved).toString(),
    averageCost: averageCost.toFixed(6),
    value: toSriAmount(value.toDecimalPlaces(2)),
  };
}

const levelsOf = (tx: Tx, productIds: string[], warehouseId: string | null) =>
  productIds.length === 0
    ? Promise.resolve([])
    : tx.db
        .select()
        .from(schema.stockLevels)
        .where(
          and(
            inArray(schema.stockLevels.productId, productIds),
            warehouseId ? eq(schema.stockLevels.warehouseId, warehouseId) : undefined,
          ),
        );

export const stockFilters = z.object({
  warehouseId: z.uuid().optional(),
  query: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type StockFilters = z.input<typeof stockFilters>;

export const STOCK_PAGE_SIZE = 50;

export type StockRow = StockedProduct & StockFigures;

// Every good that tracks stock, with what the chosen warehouse, or all of them, holds.
export async function listStock(
  ctx: ActorContext,
  db: Database,
  raw: StockFilters = {},
): Promise<{
  rows: StockRow[];
  total: number;
  page: number;
  pageSize: number;
  warehouses: Warehouse[];
}> {
  canRead(ctx);
  const filters = stockFilters.parse(raw);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const warehouses = await warehousesOf(tx);
    const products = await stockedProducts(tx, {
      query: filters.query,
      offset: (filters.page - 1) * STOCK_PAGE_SIZE,
      limit: STOCK_PAGE_SIZE,
    });
    const levels = await levelsOf(
      tx,
      products.rows.map((product) => product.id),
      filters.warehouseId ?? null,
    );
    return {
      rows: products.rows.map((product) => ({
        ...product,
        ...figures(levels.filter((level) => level.productId === product.id)),
      })),
      total: products.total,
      page: filters.page,
      pageSize: STOCK_PAGE_SIZE,
      warehouses,
    };
  });
}

export type MovementRow = {
  id: string;
  type: string;
  warehouseName: string;
  quantity: string;
  // A reservation or release changes what is held, not what is on hand.
  reserved: string;
  unitCost: string;
  value: string;
  reason: string | null;
  sourceType: string | null;
  sourceId: string | null;
  createdAt: Date;
};

export const MOVEMENTS_PAGE_SIZE = 50;

export type ProductStock = {
  product: StockedProduct;
  // One entry per active warehouse, and any inactive one that still has a level.
  warehouses: (Warehouse & StockFigures & { moved: boolean })[];
  total: StockFigures;
  movements: MovementRow[];
  movementsTotal: number;
  page: number;
  pageSize: number;
  negativeStock: 'BLOCK' | 'ALLOW';
};

// One product: what each warehouse holds and its movements, newest first.
export async function productStock(
  ctx: ActorContext,
  db: Database,
  productId: string,
  options: { page?: number } = {},
): Promise<ProductStock> {
  canRead(ctx);
  const id = z.uuid().parse(productId);
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .catch(1)
    .parse(options.page ?? 1);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const product = await productSummary(tx, id);
    if (!product || product.kind !== 'GOOD' || !product.tracksStock)
      throw new DomainError('NOT_FOUND', 'Product not found');
    const { stockMovements } = schema;
    // One after another: a transaction is one connection, which runs one query at a time.
    const warehouses = await warehousesOf(tx);
    const levels = await levelsOf(tx, [id], null);
    const moved = await tx.db
      .selectDistinct({ warehouseId: stockMovements.warehouseId })
      .from(stockMovements)
      .where(eq(stockMovements.productId, id));
    const [count] = await tx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(stockMovements)
      .where(eq(stockMovements.productId, id));
    const movements = await tx.db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.productId, id))
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(MOVEMENTS_PAGE_SIZE)
      .offset((page - 1) * MOVEMENTS_PAGE_SIZE);
    const negativeStock = await negativeStockRule(tx, ctx.tenantId);
    const movedIn = new Set(moved.map((row) => row.warehouseId));
    const names = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name]));
    return {
      product: {
        id: product.id,
        code: product.code,
        name: product.name,
        unit: product.unit,
        active: product.active,
      },
      warehouses: warehouses
        .filter(
          (warehouse) =>
            warehouse.active || levels.some((level) => level.warehouseId === warehouse.id),
        )
        .map((warehouse) => ({
          ...warehouse,
          ...figures(levels.filter((level) => level.warehouseId === warehouse.id)),
          moved: movedIn.has(warehouse.id),
        })),
      total: figures(levels),
      movements: movements.map((row) => ({
        id: row.id,
        type: row.type,
        warehouseName: names.get(row.warehouseId) ?? '',
        quantity: row.quantity,
        reserved: row.reserved,
        unitCost: row.unitCost,
        value: toSriAmount(new Dec(row.value).toDecimalPlaces(2)),
        reason: row.reason,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        createdAt: row.createdAt,
      })),
      movementsTotal: count!.total,
      page,
      pageSize: MOVEMENTS_PAGE_SIZE,
      negativeStock,
    };
  });
}

export type ValuationLine = {
  productId: string;
  code: string;
  name: string;
  unit: string | null;
  warehouseName: string;
  branchCode: string;
} & StockFigures;

export type Valuation = {
  warehouses: (Warehouse & { products: number; value: string })[];
  total: string;
  lines: ValuationLine[];
};

// FR-INV-5: what the stock is worth at its average cost, per warehouse and in all, with the
// lines behind it for export. Only levels that hold or reserve something.
export async function stockValuation(ctx: ActorContext, db: Database): Promise<Valuation> {
  canRead(ctx);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const { stockLevels } = schema;
    const warehouses = await warehousesOf(tx);
    const levels = await tx.db
      .select()
      .from(stockLevels)
      .where(sql`${stockLevels.onHand} <> 0 OR ${stockLevels.reserved} <> 0`)
      .orderBy(asc(stockLevels.warehouseId));
    const productIds = [...new Set(levels.map((level) => level.productId))];
    const products =
      productIds.length === 0
        ? []
        : (await stockedProducts(tx, { ids: productIds, offset: 0, limit: productIds.length }))
            .rows;
    const byId = new Map(products.map((product) => [product.id, product]));
    const byWarehouse = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
    const lines = levels
      .flatMap((level) => {
        const product = byId.get(level.productId);
        const warehouse = byWarehouse.get(level.warehouseId);
        if (!product || !warehouse) return [];
        return [
          {
            productId: product.id,
            code: product.code,
            name: product.name,
            unit: product.unit,
            warehouseName: warehouse.name,
            branchCode: warehouse.branchCode,
            ...figures([level]),
          },
        ];
      })
      .sort((a, b) => a.branchCode.localeCompare(b.branchCode) || a.name.localeCompare(b.name));
    const valueOf = (rows: Level[]) =>
      toSriAmount(rows.reduce((sum, level) => sum.add(level.value), new Dec(0)).toDecimalPlaces(2));
    return {
      warehouses: warehouses
        .map((warehouse) => {
          const own = levels.filter((level) => level.warehouseId === warehouse.id);
          return { ...warehouse, products: own.length, value: valueOf(own) };
        })
        .filter((warehouse) => warehouse.active || warehouse.products > 0),
      total: valueOf(levels),
      lines,
    };
  });
}
