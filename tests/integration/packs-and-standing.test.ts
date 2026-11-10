import { randomUUID } from 'node:crypto';
import {
  buyPack,
  clearOverride,
  consumePack,
  createClient,
  createKeyCipher,
  fixedClock,
  listClients,
  onboardOrganization,
  openRenewal,
  packBalance,
  reactivateCompany,
  refundPayment,
  resolveActor,
  reviewPayment,
  setBilling,
  setOverride,
  startPaidPlan,
  submitProof,
  suspendCompany,
  type ActorContext,
  type CreatedOrganization,
  type PaymentView,
  type PlatformActor,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// FR-BILL-7 (document packs), FR-BILL-5 (past due blocks writes but lets the company pay) and
// FR-BILL-9 (suspension keeps reading only). Placeholder packs: 100 for 5.00, 500 for 20.00.
describe('document packs and the write block', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let operator: PlatformActor;
  let org: CreatedOrganization;
  let ownerId: string;
  let client = 0;

  const owner = (tenantId = org.twinTenantId): Promise<ActorContext> =>
    resolveActor(db, { userId: ownerId, tenantId, clock });
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: packs and standing', ({ executeSql }) => executeSql(text, values));
  const pay = async (payment: { id: string }) => {
    await submitProof(await owner(), db, {
      paymentId: payment.id,
      reference: 'SPI-1',
      files: [{ filename: 'p.png', content: PNG }],
    });
    await reviewPayment({ ...operator, clock }, db, {
      paymentId: payment.id,
      decision: 'VERIFIED',
    });
  };
  const buy = async (packSize: number) => {
    const payment = await buyPack(await owner(), db, { packSize });
    await pay(payment);
    return payment;
  };
  const refund = (payment: PaymentView) =>
    refundPayment({ ...operator, clock }, db, { paymentId: payment.id, reason: 'Duplicado' });
  const balance = () =>
    db.withSystem('test: pack balance', ({ db: tx }) => packBalance(tx, org.realTenantId));
  const spend = () =>
    db.withSystem('test: spend a pack', ({ db: tx }) => consumePack(tx, org.realTenantId));
  const newClient = async (ctx: ActorContext) =>
    createClient(ctx, db, {
      idType: '05',
      identification: ['1710034065', '0102030400', '0912345675'][client++ % 3]!,
      name: `Cliente ${client}`,
      emails: [],
      address: null,
    });

  beforeAll(async () => {
    db = appDatabase();
    operator = await superAdmin(db);
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `pk.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Sigma Tau S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2026-01-01'),
            notAfter: new Date('2028-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher: createKeyCipher('d5'.repeat(32)), clock },
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('keeps the database to the rules', async () => {
    const { rows } = await sql(
      `SELECT prosrc FROM pg_proc WHERE proname = 'app_pack_status_check'`,
    );
    expect((rows[0] as { prosrc: string }).prosrc).toContain(schema.packStatusTriggerBody());
    // Only the operator suspends: the company's own context can't, even on its own row.
    await expect(
      db.withTenant({ tenantId: org.realTenantId }, ({ executeSql }) =>
        executeSql(
          `UPDATE tenants SET status = 'SUSPENDED', suspension_reason = 'OTHER',
             suspended_at = now() WHERE id = $1`,
          [org.realTenantId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('sells a pack at its price of the day, never to an unlimited or complimentary company', async () => {
    expect(await failure(buyPack(await owner(), db, { packSize: 300 }))).toBe('PACK_NOT_SOLD');
    await setBilling({ ...operator, clock }, db, {
      realTenantId: org.realTenantId,
      complimentary: true,
      reason: 'Socio',
    });
    expect(await failure(buyPack(await owner(), db, { packSize: 100 }))).toBe(
      'SUBSCRIPTION_COMPLIMENTARY',
    );
    await setBilling({ ...operator, clock }, db, {
      realTenantId: org.realTenantId,
      complimentary: false,
    });
    await setOverride({ ...operator, clock }, db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOCUMENT_QUOTA',
      effect: 'LIMIT',
      limitValue: null,
      reason: 'test',
    });
    expect(await failure(buyPack(await owner(), db, { packSize: 100 }))).toBe('QUOTA_UNLIMITED');
    await clearOverride({ ...operator, clock }, db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOCUMENT_QUOTA',
    });

    // Gratis can top up too: it has a quota to run out of.
    const payment = await buyPack(await owner(), db, { packSize: 100 });
    expect(payment).toMatchObject({
      purpose: 'DOCUMENT_PACK',
      packSize: 100,
      baseAmount: '5.00',
      ivaAmount: '0.75',
      totalAmount: '5.75',
    });
    expect(await balance()).toBe(0);
    await pay(payment);
    expect(await balance()).toBe(100);
    // The twin never pays or spends: the packs are the real company's alone.
    const { rows } = await sql(
      `SELECT count(*)::int AS n FROM document_packs WHERE tenant_id = $1`,
      [org.twinTenantId],
    );
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('spends the oldest pack first, and refunds only one nobody used', async () => {
    const second = await buy(500);
    const [first] = (
      await sql(
        `SELECT payment_id AS id FROM document_packs WHERE tenant_id = $1 ORDER BY created_at`,
        [org.realTenantId],
      )
    ).rows as { id: string }[];
    await sql(`UPDATE document_packs SET used = 99 WHERE payment_id = $1`, [first!.id]);
    expect(await spend()).toBe(true);
    expect(await spend()).toBe(true);
    const used = (
      await sql(`SELECT size, used FROM document_packs WHERE tenant_id = $1 ORDER BY created_at`, [
        org.realTenantId,
      ])
    ).rows;
    expect(used).toEqual([
      { size: 100, used: 100 },
      { size: 500, used: 1 },
    ]);
    expect(await balance()).toBe(499);
    expect(await failure(refund(second))).toBe('PACK_IN_USE');

    // An untouched pack goes back, even with a later payment after it.
    const third = await buy(100);
    await buy(100);
    await refund(third);
    expect(await balance()).toBe(599);
    const { rows } = await sql(`SELECT status FROM payments WHERE id = $1`, [third.id]);
    expect(rows[0]).toEqual({ status: 'REFUNDED' });
  });

  it('runs out cleanly when every pack is spent', async () => {
    await sql(`UPDATE document_packs SET used = size WHERE tenant_id = $1 AND status = 'ACTIVE'`, [
      org.realTenantId,
    ]);
    expect(await spend()).toBe(false);
  });

  it('blocks a past-due company’s writes, twin included, and lets it pay the renewal', async () => {
    const initial = await startPaidPlan(await owner(), db, {
      planKey: 'STARTER',
      interval: 'MONTHLY',
    });
    await pay(initial);
    clock.set('2026-12-05T15:00:00Z');
    const renewal = await db.withSystem('test: open the renewal', ({ db: tx }) =>
      openRenewal(tx, org.realTenantId, clock.now()),
    );
    expect(renewal).not.toBeNull();
    // What the daily job does after the grace (step 5).
    await sql(`UPDATE subscriptions SET status = 'PAST_DUE' WHERE tenant_id = ANY($1)`, [
      [org.realTenantId, org.twinTenantId],
    ]);

    for (const tenantId of [org.realTenantId, org.twinTenantId]) {
      const ctx = await owner(tenantId);
      expect(ctx.standing).toBe('PAST_DUE');
      expect(await failure(newClient(ctx))).toBe('ACCOUNT_PAST_DUE');
      await expect(listClients(ctx, db)).resolves.toBeDefined();
    }
    expect(await failure(buyPack(await owner(), db, { packSize: 100 }))).toBe('ACCOUNT_PAST_DUE');

    await pay(renewal!);
    const ctx = await owner();
    expect(ctx.standing).toBe('GOOD');
    await newClient(ctx);
  });

  it('leaves a suspended company only reading, twin included, until reactivated', async () => {
    await suspendCompany({ ...operator, clock }, db, {
      realTenantId: org.realTenantId,
      reason: 'FRAUD_SUSPECTED',
      note: 'Pago revertido por el banco',
    });
    expect(
      await failure(
        suspendCompany({ ...operator, clock }, db, {
          realTenantId: org.realTenantId,
          reason: 'OTHER',
        }),
      ),
    ).toBe('ALREADY_SUSPENDED');
    for (const tenantId of [org.realTenantId, org.twinTenantId]) {
      const ctx = await owner(tenantId);
      expect(ctx.standing).toBe('SUSPENDED');
      expect(await failure(newClient(ctx))).toBe('ACCOUNT_SUSPENDED');
      await expect(listClients(ctx, db)).resolves.toBeDefined();
    }
    // Paying doesn't lift a suspension: the operator decides.
    expect(await failure(buyPack(await owner(), db, { packSize: 100 }))).toBe('ACCOUNT_SUSPENDED');

    await reactivateCompany({ ...operator, clock }, db, { realTenantId: org.realTenantId });
    expect(
      await failure(
        reactivateCompany({ ...operator, clock }, db, { realTenantId: org.realTenantId }),
      ),
    ).toBe('NOT_SUSPENDED');
    expect((await owner()).standing).toBe('GOOD');
    const { rows } = await sql(
      `SELECT action, details->>'reason' AS reason FROM audit_events
       WHERE tenant_id = $1 AND action LIKE 'organization.%' AND action <> 'organization.created'
       ORDER BY occurred_at`,
      [org.realTenantId],
    );
    expect(rows).toEqual([
      { action: 'organization.suspended', reason: 'FRAUD_SUSPECTED' },
      { action: 'organization.reactivated', reason: null },
    ]);
  });
});
