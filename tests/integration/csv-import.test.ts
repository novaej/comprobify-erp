import { randomUUID } from 'node:crypto';
import {
  createKeyCipher,
  exportClients,
  exportProducts,
  fixedClock,
  importClients,
  importProducts,
  listClients,
  listProducts,
  onboardOrganization,
  parseCsv,
  resolveActor,
  toCsv,
  type CreatedOrganization,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase } from './helpers';

// FR-MD-1, FR-MD-2: clients and products in and out as a spreadsheet. A file with a wrong line
// writes nothing and names the lines; one that is right creates what is new and updates what a
// code or identification already holds.
describe('CSV import and export', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let org: CreatedOrganization;
  let ownerId: string;
  let viewerId: string;
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: csv setup', ({ executeSql }) => executeSql(text, values));
  const as = (userId: string) => resolveActor(db, { userId, tenantId: org.realTenantId, clock });
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };
  const everyProduct = async () =>
    (await listProducts(await as(ownerId), db, { includeInactive: true })).sort((a, b) =>
      a.code.localeCompare(b.code),
    );

  beforeAll(async () => {
    db = appDatabase();
    const users = await db.identity
      .insert(schema.users)
      .values(
        ['Owner', 'Viewer'].map((name) => ({
          name,
          email: `ci.${randomUUID()}@example.com`,
          emailVerified: true,
        })),
      )
      .returning({ id: schema.users.id });
    ownerId = users[0]!.id;
    viewerId = users[1]!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Lambda S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2026-01-01'),
            notAfter: new Date('2030-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher: createKeyCipher('a9'.repeat(32)), clock },
    );
    await sql(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'VIEWER')`, [
      org.realTenantId,
      viewerId,
    ]);
  });

  afterAll(() => db.close());

  it('creates products from a Spanish spreadsheet, and reads its own export back as no change', async () => {
    const file = [
      'codigo;nombre;tipo;precio;costo;iva;controla_stock;unidad;detalle1_nombre;detalle1_valor',
      'CAF-1;Café molido;bien;5,50;2,25;4;si;kg;Origen;Loja',
      'SRV-1;Instalación;servicio;30;;0;no;;;',
      'CAF-2;Café tostado;Bien;7;;15%;;;;',
    ].join('\r\n');
    const owner = await as(ownerId);
    const result = await importProducts(owner, db, file);
    expect(result).toEqual({ created: 3, updated: 0, problems: [] });
    const products = await everyProduct();
    expect(
      products.map((p) => [p.code, p.kind, p.price, p.cost, p.ivaRateCode, p.tracksStock]),
    ).toEqual([
      ['CAF-1', 'GOOD', '5.500000', '2.250000', '4', true],
      ['CAF-2', 'GOOD', '7.000000', null, '4', false],
      ['SRV-1', 'SERVICE', '30.000000', null, '0', false],
    ]);
    expect(products[0]!.additionalDetails).toEqual([{ name: 'Origen', value: 'Loja' }]);

    // What an export says, an import takes back: nothing is created, and nothing changes.
    for (const [locale, decimal, delimiter] of [
      ['es', ',', ';'],
      ['en', '.', ','],
    ] as const) {
      const exported = toCsv(await exportProducts(owner, db, { locale, decimal }), delimiter);
      expect(parseCsv(exported).rows).toHaveLength(4);
      const again = await importProducts(owner, db, exported);
      expect(again).toEqual({ created: 0, updated: 3, problems: [] });
    }
    expect((await everyProduct()).map((p) => [p.code, p.price, p.cost])).toEqual(
      products.map((p) => [p.code, p.price, p.cost]),
    );
  });

  it('updates by code, and keeps `active` as it is unless the file says', async () => {
    const owner = await as(ownerId);
    await sql(`UPDATE products SET active = false WHERE tenant_id = $1 AND code = 'SRV-1'`, [
      org.realTenantId,
    ]);
    const result = await importProducts(
      owner,
      db,
      'code,name,type,price,iva_code\nSRV-1,Instalación nueva,service,35.50,0\nNEW-1,Nuevo,good,1,4',
    );
    expect(result).toEqual({ created: 1, updated: 1, problems: [] });
    const service = (await everyProduct()).find((p) => p.code === 'SRV-1')!;
    expect([service.name, service.price, service.active]).toEqual([
      'Instalación nueva',
      '35.500000',
      false,
    ]);
    await importProducts(
      owner,
      db,
      'code,name,type,price,iva_code,active\nSRV-1,Instalación nueva,service,35.50,0,yes',
    );
    expect((await everyProduct()).find((p) => p.code === 'SRV-1')!.active).toBe(true);
  });

  it('names every wrong line and writes nothing', async () => {
    const owner = await as(ownerId);
    const before = (await everyProduct()).length;
    const file = [
      'code,name,type,price,iva_code,tracks_stock',
      'OK-1,Bueno,good,1,4,no',
      'BAD-1,Tarifa mala,good,1,99,no',
      'BAD-2,Servicio con stock,service,1,4,yes',
      'BAD-3,Precio mal,good,abc,4,no',
      ',Sin código,good,1,4,no',
      'OK-1,Repetido,good,1,4,no',
      'BAD-4,Stock raro,good,1,4,quizás',
    ].join('\n');
    const result = await importProducts(owner, db, file);
    expect(result.created + result.updated).toBe(0);
    expect(result.problems).toEqual([
      { line: 3, code: 'INVALID_FIELD', field: 'iva_code' },
      { line: 4, code: 'INVALID_FIELD', field: 'tracks_stock' },
      { line: 5, code: 'INVALID_FIELD', field: 'price' },
      { line: 6, code: 'INVALID_FIELD', field: 'code' },
      { line: 7, code: 'DUPLICATE_ROW', field: 'code' },
      { line: 8, code: 'INVALID_FIELD', field: 'tracks_stock' },
    ]);
    expect((await everyProduct()).length).toBe(before);
    expect((await everyProduct()).map((p) => p.code)).not.toContain('OK-1');
  });

  it('refuses to stop tracking stock a warehouse holds, and then imports nothing at all', async () => {
    const owner = await as(ownerId);
    const [warehouse] = (
      await sql(`SELECT id FROM warehouses WHERE tenant_id = $1 LIMIT 1`, [org.realTenantId])
    ).rows as { id: string }[];
    const held = (await everyProduct()).find((p) => p.code === 'CAF-1')!;
    await sql(
      `INSERT INTO stock_levels (tenant_id, product_id, warehouse_id, on_hand) VALUES ($1, $2, $3, 5)`,
      [org.realTenantId, held.id, warehouse!.id],
    );
    const result = await importProducts(
      owner,
      db,
      'code,name,type,price,iva_code,tracks_stock\nFRESH-1,Fresco,good,1,4,no\nCAF-1,Café molido,good,5.5,4,no',
    );
    expect(result).toEqual({
      created: 0,
      updated: 0,
      problems: [{ line: 3, code: 'STOCK_HELD', field: 'tracks_stock' }],
    });
    expect((await everyProduct()).map((p) => p.code)).not.toContain('FRESH-1');
  });

  it('refuses a file without its columns, an empty one, and who may not manage', async () => {
    const owner = await as(ownerId);
    expect(await failure(importProducts(owner, db, 'code,name\nA,B'))).toBe('IMPORT_COLUMNS');
    expect(await failure(importProducts(owner, db, ''))).toBe('IMPORT_EMPTY');
    expect(await failure(importProducts(owner, db, 'code,name,type,price,iva_code'))).toBe(
      'IMPORT_EMPTY',
    );
    const viewer = await as(viewerId);
    expect(
      await failure(importProducts(viewer, db, 'code,name,type,price,iva_code\nA,B,good,1,4')),
    ).toBe('FORBIDDEN');
    // A viewer reads the catalogue, so takes the file.
    await expect(exportProducts(viewer, db, { locale: 'es', decimal: ',' })).resolves.toBeTruthy();
  });

  it('imports clients with their terms, updates by identification, and exports them back', async () => {
    const owner = await as(ownerId);
    const ruc = testRuc();
    const file = [
      'tipo_identificacion;identificacion;nombre;correos;telefono;direccion;plazo;unidad_plazo',
      `ruc;${ruc};Comercial Uno S.A.;compras@uno.test | pagos@uno.test;022345678;Quito;30;dias`,
      '05;1710034065;María Pérez;maria@example.test;;;;',
    ].join('\r\n');
    expect(await importClients(owner, db, file)).toEqual({ created: 2, updated: 0, problems: [] });
    const clients = await listClients(owner, db, { includeInactive: true });
    const uno = clients.find((c) => c.identification === ruc)!;
    expect([uno.idType, uno.emails, uno.paymentTerm, uno.paymentTermUnit]).toEqual([
      '04',
      ['compras@uno.test', 'pagos@uno.test'],
      30,
      'dias',
    ]);

    // The same identification again is an update.
    expect(
      await importClients(
        owner,
        db,
        `id_type,identification,name,emails\n04,${ruc},Comercial Uno Renombrado,nuevo@uno.test`,
      ),
    ).toEqual({ created: 0, updated: 1, problems: [] });
    expect(
      (await listClients(owner, db, { includeInactive: true })).find(
        (c) => c.identification === ruc,
      )!.name,
    ).toBe('Comercial Uno Renombrado');

    const exported = toCsv(await exportClients(owner, db, { locale: 'es' }), ';');
    expect(parseCsv(exported).rows[0]).toEqual([
      'tipo_identificacion',
      'identificacion',
      'nombre',
      'correos',
      'telefono',
      'direccion',
      'plazo',
      'unidad_plazo',
      'activo',
    ]);
    expect(await importClients(owner, db, exported)).toMatchObject({ created: 0, updated: 2 });
  });

  it('names the wrong client lines too, and writes nothing', async () => {
    const owner = await as(ownerId);
    const before = (await listClients(owner, db, { includeInactive: true })).length;
    const result = await importClients(
      owner,
      db,
      [
        'id_type,identification,name,emails,payment_term,payment_term_unit',
        '05,1710034066,Cédula mala,,,',
        '05,1710034065,Correo malo,no-es-correo,,',
        '05,1710034065,Primera,,,',
        '05,1710034065,Repetida,,,',
        '04,,Sin identificación,,,',
        `04,${testRuc()},Plazo sin unidad,,15,`,
      ].join('\n'),
    );
    expect(result.problems).toEqual([
      { line: 2, code: 'INVALID_FIELD', field: 'identification' },
      { line: 3, code: 'INVALID_FIELD', field: 'emails' },
      { line: 5, code: 'DUPLICATE_ROW', field: 'identification' },
      { line: 6, code: 'INVALID_FIELD', field: 'identification' },
      { line: 7, code: 'INVALID_FIELD', field: 'payment_term_unit' },
    ]);
    expect((await listClients(owner, db, { includeInactive: true })).length).toBe(before);
  });
});
