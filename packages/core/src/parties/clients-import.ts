import { and, asc, eq, inArray, schema, sql, type Database } from '@comprobify/db';
import {
  csvBoolean,
  normalHeader,
  readCsvTable,
  requireFeature,
  requirePermission,
  type ActorContext,
  type CsvColumns,
  type CsvProblem,
} from '../kernel';
import { clientInput } from './input';

// FR-MD-2: clients as a spreadsheet, in and out, on the same terms as products: the file is
// checked whole, a wrong line changes nothing, and an identification already on file is updated.
export const CLIENT_IMPORT_MAX_ROWS = 5000;

type Key =
  | 'idType'
  | 'identification'
  | 'name'
  | 'emails'
  | 'phone'
  | 'address'
  | 'paymentTerm'
  | 'paymentTermUnit'
  | 'active';

const HEADERS: Record<Key, { es: string; en: string; also?: string[] }> = {
  idType: { es: 'tipo_identificacion', en: 'id_type', also: ['tipo'] },
  identification: { es: 'identificacion', en: 'identification', also: ['id'] },
  name: { es: 'nombre', en: 'name' },
  emails: { es: 'correos', en: 'emails', also: ['correo', 'email'] },
  phone: { es: 'telefono', en: 'phone' },
  address: { es: 'direccion', en: 'address' },
  paymentTerm: { es: 'plazo', en: 'payment_term' },
  paymentTermUnit: { es: 'unidad_plazo', en: 'payment_term_unit' },
  active: { es: 'activo', en: 'active' },
};
const KEYS = Object.keys(HEADERS) as Key[];
const COLUMNS = {} as CsvColumns<Key>;
for (const key of KEYS)
  COLUMNS[key] = [HEADERS[key].es, HEADERS[key].en, ...(HEADERS[key].also ?? [])];

const FIELD: Record<string, string> = {
  idType: 'id_type',
  identification: 'identification',
  name: 'name',
  emails: 'emails',
  phone: 'phone',
  address: 'address',
  paymentTerm: 'payment_term',
  paymentTermUnit: 'payment_term_unit',
};

// The SRI's codes, or the word people use for them.
const ID_TYPES: Record<string, string> = {
  ruc: '04',
  cedula: '05',
  passport: '06',
  pasaporte: '06',
  foreign: '08',
  exterior: '08',
};
const UNITS: Record<string, string> = {
  days: 'dias',
  day: 'dias',
  months: 'meses',
  month: 'meses',
};

export type ClientImportResult = { created: number; updated: number; problems: CsvProblem[] };

export async function importClients(
  ctx: ActorContext,
  db: Database,
  text: string,
): Promise<ClientImportResult> {
  requireFeature(ctx, 'CLIENTS');
  requirePermission(ctx, 'clients.manage');
  const csv = readCsvTable<Key>(
    text,
    COLUMNS,
    ['idType', 'identification', 'name'],
    CLIENT_IMPORT_MAX_ROWS,
  );

  const problems: CsvProblem[] = [];
  const planned: { input: ReturnType<typeof clientInput.parse>; active: boolean | null }[] = [];
  const seen = new Set<string>();
  for (const row of csv.rows) {
    const bad = (field: string, code = 'INVALID_FIELD') =>
      problems.push({ line: row.line, code, field });
    const blank = (key: Key) => (row.cell(key) === '' ? null : row.cell(key));
    const type = normalHeader(row.cell('idType'));
    const unit = normalHeader(row.cell('paymentTermUnit'));
    const term = blank('paymentTerm');
    const active = row.cell('active');
    const activeValue = active === '' ? null : csvBoolean(active);
    const parsed = clientInput.safeParse({
      idType: ID_TYPES[type] ?? (/^\d$/.test(type) ? `0${type}` : type),
      identification: row.cell('identification'),
      name: row.cell('name'),
      emails: row
        .cell('emails')
        .split(/[|\s;,]+/)
        .filter(Boolean),
      phone: blank('phone'),
      address: blank('address'),
      paymentTerm: term === null ? null : Number(term),
      paymentTermUnit: unit === '' ? null : (UNITS[unit] ?? unit),
    });
    if (!parsed.success) {
      bad(FIELD[String(parsed.error.issues[0]?.path[0])] ?? 'identification');
      continue;
    }
    if (active !== '' && activeValue === null) {
      bad('active');
      continue;
    }
    if (seen.has(parsed.data.identification)) {
      bad('identification', 'DUPLICATE_ROW');
      continue;
    }
    seen.add(parsed.data.identification);
    planned.push({ input: parsed.data, active: activeValue });
  }
  if (problems.length > 0) return { created: 0, updated: 0, problems };

  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const { clients } = schema;
    const existing = new Map(
      (
        await tx
          .select({ id: clients.id, identification: clients.identification })
          .from(clients)
          .where(
            inArray(
              clients.identification,
              planned.map((entry) => entry.input.identification),
            ),
          )
      ).map((row) => [row.identification, row.id]),
    );
    let created = 0;
    let updated = 0;
    for (const { input, active } of planned) {
      const id = existing.get(input.identification);
      if (id) {
        await tx
          .update(clients)
          .set({
            ...input,
            ...(active === null || !csv.has('active') ? {} : { active }),
            updatedAt: sql`now()`,
          })
          .where(and(eq(clients.id, id)));
        updated++;
      } else {
        await tx
          .insert(clients)
          .values({ tenantId: ctx.tenantId, ...input, active: active ?? true });
        created++;
      }
    }
    return { created, updated, problems: [] };
  });
}

// Every client, active or not, by name, in the person's language.
export async function exportClients(
  ctx: ActorContext,
  db: Database,
  options: { locale: 'es' | 'en' },
): Promise<string[][]> {
  requireFeature(ctx, 'CLIENTS');
  requirePermission(ctx, 'clients.read');
  const rows = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx
      .select()
      .from(schema.clients)
      .orderBy(asc(schema.clients.name), asc(schema.clients.identification)),
  );
  const spanish = options.locale === 'es';
  return [
    KEYS.map((key) => HEADERS[key][options.locale]),
    ...rows.map((row) => [
      row.idType,
      row.identification,
      row.name,
      row.emails.join('|'),
      row.phone ?? '',
      row.address ?? '',
      row.paymentTerm === null ? '' : String(row.paymentTerm),
      row.paymentTermUnit ?? '',
      spanish ? (row.active ? 'si' : 'no') : row.active ? 'yes' : 'no',
    ]),
  ];
}
