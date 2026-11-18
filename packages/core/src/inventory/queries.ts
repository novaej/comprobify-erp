import { and, asc, eq, lt, inArray, schema, sql, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { productSummary, stockedProducts, type StockedProduct } from '../catalog';
import {
  Dec,
  DomainError,
  requireFeature,
  requirePermission,
  toSriAmount,
  type ActorContext,
  cursorInput,
  keysetPage,
  type KeysetRequest,
  ecuadorDate,
  endOfEcuadorDay,
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
  // NFR-PERF-4: cursors to the next and previous pages of movements, or null.
  movementsNext: string | null;
  movementsPrevious: string | null;
  negativeStock: 'BLOCK' | 'ALLOW';
};

// One product: what each warehouse holds and its movements, newest first.
export async function productStock(
  ctx: ActorContext,
  db: Database,
  productId: string,
  options: KeysetRequest = {},
): Promise<ProductStock> {
  canRead(ctx);
  const id = z.uuid().parse(productId);
  const cursor = {
    after: cursorInput.catch(undefined).parse(options.after),
    before: cursorInput.catch(undefined).parse(options.before),
  };
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
    // Newest first, by id: a uuidv7 grows with time and is exact, where a timestamp read back in
    // JavaScript loses its microseconds and could not be a cursor.
    const page = await keysetPage(
      [{ expr: sql`${stockMovements.id}`, direction: 'desc' }],
      cursor,
      MOVEMENTS_PAGE_SIZE,
      (seek, order, limit) =>
        tx.db
          .select()
          .from(stockMovements)
          .where(and(eq(stockMovements.productId, id), seek))
          .orderBy(...order)
          .limit(limit),
      (row) => [row.id],
    );
    const movements = page.rows;
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
      movementsNext: page.next,
      movementsPrevious: page.previous,
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
  // The day it was worked out for, in Ecuador time: today unless one was asked for.
  asOf: string;
  warehouses: (Warehouse & { products: number; value: string })[];
  total: string;
  lines: ValuationLine[];
};

// FR-INV-5: what the stock is worth at its average cost, per warehouse and in all, with the
// lines behind it for export. Only levels that hold or reserve something. With `asOf`, a past
// day (such as 31 December): the ledger summed up to the end of that day in Ecuador, the
// average cost being the value over the quantity then. The ledger is append-only, so the
// figures for a day never change.
export async function stockValuation(
  ctx: ActorContext,
  db: Database,
  options: { asOf?: string } = {},
): Promise<Valuation> {
  canRead(ctx);
  const today = ecuadorDate(ctx.clock.now());
  const asked = z.iso.date().optional().catch(undefined).parse(options.asOf);
  const asOf = asked && asked < today ? asked : today;
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const { stockLevels, stockMovements: m } = schema;
    const warehouses = await warehousesOf(tx);
    const levels: Level[] =
      asOf === today
        ? await tx.db
            .select()
            .from(stockLevels)
            .where(sql`${stockLevels.onHand} <> 0 OR ${stockLevels.reserved} <> 0`)
            .orderBy(asc(stockLevels.warehouseId))
        : (
            await tx.db
              .select({
                productId: m.productId,
                warehouseId: m.warehouseId,
                onHand: sql<string>`sum(${m.quantity})`,
                reserved: sql<string>`sum(${m.reserved})`,
                value: sql<string>`sum(${m.value})`,
              })
              .from(m)
              // Before the next day's midnight, so no fraction of the last millisecond is lost.
              .where(lt(m.createdAt, new Date(endOfEcuadorDay(asOf).getTime() + 1)))
              .groupBy(m.productId, m.warehouseId)
              .having(sql`sum(${m.quantity}) <> 0 OR sum(${m.reserved}) <> 0`)
              .orderBy(asc(m.warehouseId))
          ).map((row) => ({
            ...row,
            id: `${row.productId}:${row.warehouseId}`,
            tenantId: ctx.tenantId,
            createdAt: endOfEcuadorDay(asOf),
            averageCost: new Dec(row.onHand).gt(0)
              ? new Dec(row.value).div(row.onHand).toFixed(6)
              : '0',
            updatedAt: endOfEcuadorDay(asOf),
          }));
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
      asOf,
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
