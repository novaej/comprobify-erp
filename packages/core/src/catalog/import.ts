import { asc, eq, schema, sql, type Database } from '@comprobify/db';
import {
  csvBoolean,
  csvDecimal,
  Dec,
  readCsvTable,
  requireFeature,
  requirePermission,
  type ActorContext,
  type CsvColumns,
  type CsvProblem,
} from '../kernel';
import { isStockHeld, productInput, productsByCode } from './index';

// FR-MD-1: products and services as a spreadsheet, in and out. An import is checked whole before
// anything is written: a file with a wrong line changes nothing, and the person fixes the lines
// it names. A code already in the catalogue is updated, a new one is created.
export const PRODUCT_IMPORT_MAX_ROWS = 5000;

type Key =
  | 'code'
  | 'auxiliaryCode'
  | 'name'
  | 'description'
  | 'kind'
  | 'unit'
  | 'price'
  | 'cost'
  | 'ivaRate'
  | 'tracksStock'
  | 'active'
  | 'detail1Name'
  | 'detail1Value'
  | 'detail2Name'
  | 'detail2Value'
  | 'detail3Name'
  | 'detail3Value';

// The header as exported in each language, then what else a header may say. Imports read either.
const HEADERS: Record<Key, { es: string; en: string; also?: string[] }> = {
  code: { es: 'codigo', en: 'code' },
  auxiliaryCode: { es: 'codigo_auxiliar', en: 'auxiliary_code' },
  name: { es: 'nombre', en: 'name' },
  description: { es: 'descripcion', en: 'description' },
  kind: { es: 'tipo', en: 'type', also: ['kind'] },
  unit: { es: 'unidad', en: 'unit' },
  price: { es: 'precio', en: 'price' },
  cost: { es: 'costo', en: 'cost' },
  ivaRate: { es: 'iva', en: 'iva_code', also: ['iva', 'iva_rate', 'tarifa_iva'] },
  tracksStock: { es: 'controla_stock', en: 'tracks_stock', also: ['inventario'] },
  active: { es: 'activo', en: 'active' },
  detail1Name: { es: 'detalle1_nombre', en: 'detail1_name' },
  detail1Value: { es: 'detalle1_valor', en: 'detail1_value' },
  detail2Name: { es: 'detalle2_nombre', en: 'detail2_name' },
  detail2Value: { es: 'detalle2_valor', en: 'detail2_value' },
  detail3Name: { es: 'detalle3_nombre', en: 'detail3_name' },
  detail3Value: { es: 'detalle3_valor', en: 'detail3_value' },
};
const KEYS = Object.keys(HEADERS) as Key[];
const COLUMNS = {} as CsvColumns<Key>;
for (const key of KEYS)
  COLUMNS[key] = [HEADERS[key].es, HEADERS[key].en, ...(HEADERS[key].also ?? [])];

// The column a value problem belongs to, as the file names it.
const FIELD: Record<string, string> = {
  code: 'code',
  auxiliaryCode: 'auxiliary_code',
  name: 'name',
  description: 'description',
  kind: 'type',
  unit: 'unit',
  price: 'price',
  cost: 'cost',
  ivaRateCode: 'iva_code',
  tracksStock: 'tracks_stock',
  additionalDetails: 'details',
};

const KINDS: Record<string, 'GOOD' | 'SERVICE'> = {
  good: 'GOOD',
  bien: 'GOOD',
  producto: 'GOOD',
  service: 'SERVICE',
  servicio: 'SERVICE',
};
// A rate as typed: the SRI's code, or the percentage of the one rate that has it.
const RATES: Record<string, string> = { '15': '4', '15%': '4' };

export type ProductImportResult = { created: number; updated: number; problems: CsvProblem[] };

class Abort extends Error {
  constructor(readonly problems: CsvProblem[]) {
    super('Import aborted');
  }
}

export async function importProducts(
  ctx: ActorContext,
  db: Database,
  text: string,
): Promise<ProductImportResult> {
  requireFeature(ctx, 'CATALOG');
  requirePermission(ctx, 'catalog.manage');
  const csv = readCsvTable<Key>(
    text,
    COLUMNS,
    ['code', 'name', 'kind', 'price', 'ivaRate'],
    PRODUCT_IMPORT_MAX_ROWS,
  );

  const problems: CsvProblem[] = [];
  const planned: {
    line: number;
    input: ReturnType<typeof productInput.parse>;
    active: boolean | null;
  }[] = [];
  const seen = new Set<string>();
  for (const row of csv.rows) {
    const bad = (field: string) => problems.push({ line: row.line, code: 'INVALID_FIELD', field });
    const decimal = (key: 'price' | 'cost') => csvDecimal(row.cell(key), csv.delimiter);
    const kind = KINDS[row.cell('kind').toLowerCase()] ?? row.cell('kind').toUpperCase();
    const rate = row.cell('ivaRate');
    const stock = row.cell('tracksStock');
    const active = row.cell('active');
    const details = ([1, 2, 3] as const)
      .map((n) => ({
        name: row.cell(`detail${n}Name` as Key),
        value: row.cell(`detail${n}Value` as Key),
      }))
      .filter((detail) => detail.name !== '' || detail.value !== '');
    const tracksStock = stock === '' ? false : csvBoolean(stock);
    const activeValue = active === '' ? null : csvBoolean(active);
    const blank = (value: string) => (value === '' ? null : value);
    const parsed = productInput.safeParse({
      code: row.cell('code'),
      auxiliaryCode: blank(row.cell('auxiliaryCode')),
      name: row.cell('name'),
      description: blank(row.cell('description')),
      kind,
      unit: blank(row.cell('unit')),
      price: decimal('price'),
      cost: blank(row.cell('cost')) === null ? null : decimal('cost'),
      ivaRateCode: RATES[rate] ?? rate,
      tracksStock: tracksStock ?? false,
      additionalDetails: details,
    });
    if (!parsed.success) {
      bad(FIELD[String(parsed.error.issues[0]?.path[0])] ?? 'code');
      continue;
    }
    if (tracksStock === null) {
      bad('tracks_stock');
      continue;
    }
    if (active !== '' && activeValue === null) {
      bad('active');
      continue;
    }
    if (parsed.data.kind === 'SERVICE' && parsed.data.tracksStock) {
      bad('tracks_stock');
      continue;
    }
    if (seen.has(parsed.data.code)) {
      problems.push({ line: row.line, code: 'DUPLICATE_ROW', field: 'code' });
      continue;
    }
    seen.add(parsed.data.code);
    planned.push({ line: row.line, input: parsed.data, active: activeValue });
  }
  if (problems.length > 0) return { created: 0, updated: 0, problems };

  try {
    return await db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
      const existing = new Map(
        (
          await productsByCode(
            tx,
            planned.map((entry) => entry.input.code),
          )
        ).map((row) => [row.code, row.id]),
      );
      let created = 0;
      let updated = 0;
      const failed: CsvProblem[] = [];
      for (const entry of planned) {
        const id = existing.get(entry.input.code);
        // A savepoint, so a line the database refuses is reported without ending the others.
        await tx.executeSql('SAVEPOINT import_row');
        try {
          if (id) {
            await tx.db
              .update(schema.products)
              .set({
                ...entry.input,
                ...(entry.active === null || !csv.has('active') ? {} : { active: entry.active }),
                updatedAt: sql`now()`,
              })
              .where(eq(schema.products.id, id));
            updated++;
          } else {
            await tx.db.insert(schema.products).values({
              tenantId: ctx.tenantId,
              ...entry.input,
              active: entry.active ?? true,
            });
            created++;
          }
          await tx.executeSql('RELEASE SAVEPOINT import_row');
        } catch (error) {
          if (!isStockHeld(error)) throw error;
          await tx.executeSql('ROLLBACK TO SAVEPOINT import_row');
          failed.push({ line: entry.line, code: 'STOCK_HELD', field: 'tracks_stock' });
        }
      }
      // One wrong line undoes the file: it is imported once, whole.
      if (failed.length > 0) throw new Abort(failed);
      return { created, updated, problems: [] };
    });
  } catch (error) {
    if (error instanceof Abort) return { created: 0, updated: 0, problems: error.problems };
    throw error;
  }
}

// The catalogue as the file an import reads: every product, active or not, by name. Headers and
// the words for type and yes/no are in the person's language; numbers use the spreadsheet's
// decimal mark.
export async function exportProducts(
  ctx: ActorContext,
  db: Database,
  options: { locale: 'es' | 'en'; decimal: ',' | '.' },
): Promise<string[][]> {
  requireFeature(ctx, 'CATALOG');
  requirePermission(ctx, 'catalog.read');
  const rows = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx.select().from(schema.products).orderBy(asc(schema.products.name), asc(schema.products.code)),
  );
  const spanish = options.locale === 'es';
  const number = (value: string | null) => {
    if (value === null) return '';
    const dec = new Dec(value);
    const text = dec.toFixed(Math.max(2, dec.decimalPlaces()));
    return options.decimal === ',' ? text.replace('.', ',') : text;
  };
  const yes = (value: boolean) => (spanish ? (value ? 'si' : 'no') : value ? 'yes' : 'no');
  return [
    KEYS.map((key) => HEADERS[key][options.locale]),
    ...rows.map((row) => [
      row.code,
      row.auxiliaryCode ?? '',
      row.name,
      row.description ?? '',
      row.kind === 'GOOD' ? (spanish ? 'bien' : 'good') : spanish ? 'servicio' : 'service',
      row.unit ?? '',
      number(row.price),
      number(row.cost),
      row.ivaRateCode,
      yes(row.tracksStock),
      yes(row.active),
      ...([0, 1, 2] as const).flatMap((index) => [
        row.additionalDetails[index]?.name ?? '',
        row.additionalDetails[index]?.value ?? '',
      ]),
    ]),
  ];
}
