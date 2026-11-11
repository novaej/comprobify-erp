import { randomUUID } from 'node:crypto';
import { and, eq, inArray, schema, type Database } from '@comprobify/db';
import { z } from 'zod';
import { productsByCode } from '../catalog';
import {
  csvDecimal,
  Dec,
  preciseInput,
  readCsvTable,
  requireFeature,
  requirePermission,
  type ActorContext,
} from '../kernel';
import { warehousesOf } from '../tenancy';
import { applyMovement, type StockLevel, type StockMovement } from './ledger';

// FR-INV-3: what a person does to stock by hand. Every change is a movement with its author,
// and an adjustment says why.

const positive = preciseInput.refine((value) => new Dec(value).gt(0), 'Must be more than 0');

function canAdjust(ctx: ActorContext) {
  requireFeature(ctx, 'INVENTORY');
  requirePermission(ctx, 'inventory.adjust');
}

export const adjustmentInput = z.object({
  productId: z.uuid(),
  warehouseId: z.uuid(),
  // IN for goods found or given, OUT for goods lost, broken or used.
  direction: z.enum(['IN', 'OUT']),
  quantity: positive,
  // Goods in only; empty takes them in at the current average. Goods out leave at the average.
  unitCost: preciseInput.nullable().default(null),
  reason: z.string().trim().min(1).max(300),
});
export type AdjustmentInput = z.input<typeof adjustmentInput>;

type Applied = { movement: StockMovement; level: StockLevel };

export async function adjustStock(
  ctx: ActorContext,
  db: Database,
  raw: AdjustmentInput,
): Promise<Applied> {
  canAdjust(ctx);
  const input = adjustmentInput.parse(raw);
  const common = {
    productId: input.productId,
    warehouseId: input.warehouseId,
    quantity: input.quantity,
    reason: input.reason,
  };
  return db.withTenant({ tenantId: ctx.tenantId }, (tx) =>
    applyMovement(
      ctx,
      tx,
      input.direction === 'IN'
        ? { type: 'ADJUSTMENT_IN', unitCost: input.unitCost, ...common }
        : { type: 'ADJUSTMENT_OUT', ...common },
    ),
  );
}

export const openingBalanceInput = z.object({
  productId: z.uuid(),
  warehouseId: z.uuid(),
  quantity: positive,
  unitCost: preciseInput,
});
export type OpeningBalanceInput = z.input<typeof openingBalanceInput>;

// What a warehouse held before the company started here: only as its first movement.
export async function setOpeningBalance(
  ctx: ActorContext,
  db: Database,
  raw: OpeningBalanceInput,
): Promise<Applied> {
  canAdjust(ctx);
  const input = openingBalanceInput.parse(raw);
  return db.withTenant({ tenantId: ctx.tenantId }, (tx) =>
    applyMovement(ctx, tx, { type: 'OPENING_BALANCE', ...input }, { onlyFirst: true }),
  );
}

export const OPENING_IMPORT_MAX_ROWS = 5000;

export type ImportProblem = {
  // The line in the file, the header being line 1.
  line: number;
  code:
    | 'CODE_REQUIRED'
    | 'PRODUCT_NOT_FOUND'
    | 'PRODUCT_NOT_STOCKED'
    | 'BRANCH_REQUIRED'
    | 'BRANCH_NOT_FOUND'
    | 'QUANTITY_INVALID'
    | 'COST_INVALID'
    | 'DUPLICATE_ROW'
    | 'STOCK_ALREADY_MOVED';
};

export type OpeningImportResult = { imported: number; problems: ImportProblem[] };

// Header names in either language, without accents or case.
const COLUMNS = {
  code: ['code', 'codigo'],
  branch: ['branch', 'sucursal'],
  quantity: ['quantity', 'cantidad'],
  unitCost: ['unit_cost', 'cost', 'costo', 'costo_unitario'],
} as const;
// FR-INV-3: opening balances from a spreadsheet. Every line is checked first and nothing is
// applied unless all of them are right, so a file is imported once, whole.
export async function importOpeningBalances(
  ctx: ActorContext,
  db: Database,
  text: string,
): Promise<OpeningImportResult> {
  canAdjust(ctx);
  const csv = readCsvTable<keyof typeof COLUMNS>(
    text,
    COLUMNS,
    ['code', 'quantity', 'unitCost'],
    OPENING_IMPORT_MAX_ROWS,
  );
  const { rows } = csv;

  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const products = new Map(
      (await productsByCode(tx, [...new Set(rows.map((row) => row.cell('code')))])).map((p) => [
        p.code,
        p,
      ]),
    );
    const warehouses = (await warehousesOf(tx)).filter((warehouse) => warehouse.active);
    const byBranch = new Map(warehouses.map((warehouse) => [warehouse.branchCode, warehouse]));

    const problems: ImportProblem[] = [];
    const planned: {
      line: number;
      productId: string;
      warehouseId: string;
      quantity: string;
      unitCost: string;
    }[] = [];
    const seen = new Set<string>();
    rows.forEach((row) => {
      const line = row.line;
      const problem = (code: ImportProblem['code']) => problems.push({ line, code });
      const code = row.cell('code');
      if (!code) return problem('CODE_REQUIRED');
      const product = products.get(code);
      if (!product) return problem('PRODUCT_NOT_FOUND');
      if (product.kind !== 'GOOD' || !product.tracksStock) return problem('PRODUCT_NOT_STOCKED');
      const branch = row.cell('branch');
      const warehouse = branch
        ? byBranch.get(branch.padStart(3, '0'))
        : warehouses.length === 1
          ? warehouses[0]
          : undefined;
      if (!warehouse) return problem(branch ? 'BRANCH_NOT_FOUND' : 'BRANCH_REQUIRED');
      const quantity = csvDecimal(row.cell('quantity'), csv.delimiter);
      if (!positive.safeParse(quantity).success) return problem('QUANTITY_INVALID');
      const unitCost = csvDecimal(row.cell('unitCost'), csv.delimiter);
      if (!preciseInput.safeParse(unitCost).success) return problem('COST_INVALID');
      const key = `${product.id}:${warehouse.id}`;
      if (seen.has(key)) return problem('DUPLICATE_ROW');
      seen.add(key);
      planned.push({ line, productId: product.id, warehouseId: warehouse.id, quantity, unitCost });
    });

    // Levels that have moved already take no opening balance.
    if (planned.length > 0) {
      const moved = await tx.db
        .selectDistinct({
          productId: schema.stockMovements.productId,
          warehouseId: schema.stockMovements.warehouseId,
        })
        .from(schema.stockMovements)
        .where(
          and(
            eq(schema.stockMovements.tenantId, ctx.tenantId),
            inArray(
              schema.stockMovements.productId,
              planned.map((entry) => entry.productId),
            ),
          ),
        );
      const movedKeys = new Set(moved.map((entry) => `${entry.productId}:${entry.warehouseId}`));
      for (const entry of planned)
        if (movedKeys.has(`${entry.productId}:${entry.warehouseId}`))
          problems.push({ line: entry.line, code: 'STOCK_ALREADY_MOVED' });
    }
    if (problems.length > 0)
      return { imported: 0, problems: problems.sort((a, b) => a.line - b.line) };

    const source = { type: 'OPENING_IMPORT' as const, id: randomUUID() };
    for (const entry of planned)
      await applyMovement(
        ctx,
        tx,
        {
          type: 'OPENING_BALANCE',
          productId: entry.productId,
          warehouseId: entry.warehouseId,
          quantity: entry.quantity,
          unitCost: entry.unitCost,
          source,
        },
        { onlyFirst: true },
      );
    return { imported: planned.length, problems: [] };
  });
}
