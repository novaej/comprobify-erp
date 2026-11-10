import { randomUUID } from 'node:crypto';
import {
  changePlan,
  createKeyCipher,
  createPlan,
  discardPrice,
  draftPrice,
  fixedClock,
  onboardOrganization,
  priceBook,
  priceOn,
  publishPrice,
  STARTING_PRICES,
  updatePlan,
  type PlatformActor,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

// FR-BILL-6 (ADR-027): prices, their history, and the notice a rise owes paying companies.
describe('prices', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const today = '2026-11-10';
  let db: Database;
  let admin: PlatformActor;
  let planKey: string;
  let planId: string;
  let realTenantId: string;

  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };
  const on = (date: string, thing: Parameters<typeof priceOn>[1]) =>
    db.withSystem('test: read a price', ({ db: tx }) => priceOn(tx, thing, date));
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: run sql on prices', ({ executeSql }) => executeSql(text, values));
  const planPrice = (date: string) => on(date, { kind: 'PLAN', planId });
  const line = async (kind: string, key: string | null, packSize: number | null = null) =>
    (await priceBook(admin, db)).find(
      (entry) => entry.kind === kind && entry.key === key && entry.packSize === packSize,
    )!;

  beforeAll(async () => {
    db = appDatabase();
    admin = { ...(await superAdmin(db)), clock };
    // A plan of its own, so the notice rule sees exactly the company put on it.
    planKey = `P_${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
    await createPlan(admin, db, {
      key: planKey,
      nameEs: 'Prueba',
      nameEn: 'Test',
      selfService: true,
    });
    await updatePlan(admin, db, {
      key: planKey,
      nameEs: 'Prueba',
      nameEn: 'Test',
      selfService: true,
      status: 'PUBLISHED',
    });
    planId = (
      await db.withSystem('test: find the plan', ({ executeSql }) =>
        executeSql<{ id: string }>('SELECT id FROM plans WHERE key = $1', [planKey]),
      )
    ).rows[0]!.id;
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `pr.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    const ruc = testRuc();
    const org = await onboardOrganization(
      db,
      {
        ownerUserId: user!.id,
        ruc,
        legalName: 'Tau S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2026-01-01'),
            notAfter: new Date('2027-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher: createKeyCipher('d1'.repeat(32)), clock },
    );
    realTenantId = org.realTenantId;
  });

  afterAll(async () => {
    await db.close();
  });

  it('starts every plan, add-on, the seat and the packs from placeholders', async () => {
    const [starter] = (await sql(`SELECT id FROM plans WHERE key = 'STARTER'`)).rows as {
      id: string;
    }[];
    expect((await on(today, { kind: 'PLAN', planId: starter!.id }))?.toFixed(2)).toBe(
      STARTING_PRICES.plans.STARTER,
    );
    expect((await on(today, { kind: 'SEAT' }))?.toFixed(2)).toBe(STARTING_PRICES.seat);
    expect((await on(today, { kind: 'PACK', packSize: 500 }))?.toFixed(2)).toBe(
      STARTING_PRICES.packs[500],
    );
    // Before the placeholders' date nothing was priced.
    expect(await on('2025-12-31', { kind: 'SEAT' })).toBeNull();
    const book = await priceBook(admin, db);
    expect(book.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(['STARTER', 'BUSINESS', 'INVENTORY', 'SALES']),
    );
    // The base module and Personalizado have no list price.
    expect(book.map((entry) => entry.key)).not.toContain('INVOICING');
    expect(book.map((entry) => entry.key)).not.toContain('CUSTOM');
  });

  it('keeps the database to the rules: generated trigger, frozen history, platform-only writes', async () => {
    const [source] = (
      await sql(`SELECT prosrc FROM pg_proc WHERE proname = 'app_price_status_check'`)
    ).rows as { prosrc: string }[];
    expect(source!.prosrc).toContain(schema.priceStatusTriggerBody());
    await expect(
      sql(`UPDATE prices SET amount = 1 WHERE status = 'PUBLISHED' AND kind = 'SEAT'`),
    ).rejects.toThrow(/can not change/);
    // A company's own context can't write platform data.
    await expect(
      db.withTenant({ tenantId: realTenantId }, ({ executeSql }) =>
        executeSql(`INSERT INTO prices (kind, amount) VALUES ('SEAT', 1)`),
      ),
    ).rejects.toThrow();
  });

  it('is the super admin’s alone', async () => {
    const someone = {
      ...admin,
      userId: (await sql(`SELECT id FROM users WHERE is_super_admin = false LIMIT 1`)).rows[0]!
        .id as string,
    };
    expect(await failure(priceBook(someone, db))).toBe('FORBIDDEN');
    expect(await failure(draftPrice(someone, db, { kind: 'SEAT', amount: '1.00' }))).toBe(
      'FORBIDDEN',
    );
  });

  it('takes a first price, and any price nobody pays yet, from today', async () => {
    expect(await planPrice(today)).toBeNull();
    const { id } = await draftPrice(admin, db, { kind: 'PLAN', planKey, amount: '10.00' });
    // A draft reaches nobody.
    expect(await planPrice(today)).toBeNull();
    expect((await line('PLAN', planKey)).draft).toMatchObject({ id, amount: '10.00' });
    expect(await publishPrice(admin, db, { id })).toEqual({ effectiveOn: today, notice: false });
    expect((await planPrice(today))?.toFixed(2)).toBe('10.00');
    // Nobody is on the plan yet, so even a rise is immediate.
    const rise = await draftPrice(admin, db, { kind: 'PLAN', planKey, amount: '12.00' });
    expect(await failure(publishPrice(admin, db, { id: rise.id }))).toBe('PRICE_DATE_TAKEN');
    expect(await publishPrice(admin, db, { id: rise.id, effectiveOn: '2026-11-11' })).toEqual({
      effectiveOn: '2026-11-11',
      notice: false,
    });
    expect((await planPrice('2026-11-11'))?.toFixed(2)).toBe('12.00');
    expect((await planPrice(today))?.toFixed(2)).toBe('10.00');
  });

  it('gives paying companies 30 days’ notice of a rise, and a cut at once', async () => {
    await changePlan(admin, db, { realTenantId, planKey });
    expect((await line('PLAN', planKey)).affected).toBeGreaterThanOrEqual(1);
    const rise = await draftPrice(admin, db, { kind: 'PLAN', planKey, amount: '15.00' });
    expect(await failure(publishPrice(admin, db, { id: rise.id, effectiveOn: '2026-11-20' }))).toBe(
      'PRICE_NOTICE_TOO_SHORT',
    );
    expect(await publishPrice(admin, db, { id: rise.id })).toEqual({
      effectiveOn: '2026-12-10',
      notice: true,
    });
    // The current price holds until the date, and the book shows what is coming.
    expect((await planPrice('2026-12-09'))?.toFixed(2)).toBe('12.00');
    expect((await planPrice('2026-12-10'))?.toFixed(2)).toBe('15.00');
    expect((await line('PLAN', planKey)).upcoming).toEqual([
      { amount: '12.00', effectiveOn: '2026-11-11' },
      { amount: '15.00', effectiveOn: '2026-12-10' },
    ]);
    // Under the announced 15.00 but over today's 10.00: still a rise, so it waits too.
    const between = await draftPrice(admin, db, { kind: 'PLAN', planKey, amount: '11.00' });
    expect(
      await failure(publishPrice(admin, db, { id: between.id, effectiveOn: '2026-11-12' })),
    ).toBe('PRICE_NOTICE_TOO_SHORT');
    await discardPrice(admin, db, between.id);
    // A cut below the latest published price needs no notice.
    const cut = await draftPrice(admin, db, { kind: 'PLAN', planKey, amount: '8.00' });
    expect(await publishPrice(admin, db, { id: cut.id, effectiveOn: '2026-11-15' })).toEqual({
      effectiveOn: '2026-11-15',
      notice: false,
    });
  });

  it('adds and withdraws a pack size, and discards a draft', async () => {
    const size = 777;
    const added = await draftPrice(admin, db, { kind: 'PACK', packSize: size, amount: '30.00' });
    await publishPrice(admin, db, { id: added.id });
    expect((await on(today, { kind: 'PACK', packSize: size }))?.toFixed(2)).toBe('30.00');
    expect((await line('PACK', null, size)).current).toMatchObject({ amount: '30.00' });
    // Withdrawn from tomorrow: a pack is bought once, so nobody needs notice.
    const withdrawn = await draftPrice(admin, db, { kind: 'PACK', packSize: size, amount: null });
    await publishPrice(admin, db, { id: withdrawn.id, effectiveOn: '2026-11-11' });
    expect(await on('2026-11-11', { kind: 'PACK', packSize: size })).toBeNull();
    // Only a pack can be withdrawn; a draft can be dropped.
    expect(
      await failure(draftPrice(admin, db, { kind: 'SEAT', amount: null as unknown as string })),
    ).not.toBe('it did not fail');
    const draft = await draftPrice(admin, db, { kind: 'SEAT', amount: '9.00' });
    await discardPrice(admin, db, draft.id);
    expect((await line('SEAT', null)).draft).toBeNull();
    expect(await failure(publishPrice(admin, db, { id: draft.id }))).toBe('NOT_FOUND');
  });

  it('refuses to price what the operator negotiates and the base module', async () => {
    expect(
      await failure(draftPrice(admin, db, { kind: 'PLAN', planKey: 'CUSTOM', amount: '1.00' })),
    ).toBe('PLAN_NOT_PRICED');
    expect(
      await failure(
        draftPrice(admin, db, { kind: 'MODULE', moduleKey: 'INVOICING', amount: '1.00' }),
      ),
    ).toBe('PLAN_NOT_PRICED');
  });
});
