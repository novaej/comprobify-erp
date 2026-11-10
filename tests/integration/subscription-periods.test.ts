import { randomUUID } from 'node:crypto';
import {
  companySettings,
  createInvoice,
  createJobs,
  createKeyCipher,
  ecuadorDate,
  fixedClock,
  goLive,
  onboardOrganization,
  planOverview,
  quotaUsage,
  resolveActor,
  setOverride,
  type ActorContext,
  type CreatedOrganization,
  type InvoiceInput,
  type IssueDeps,
  type Jobs,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, superAdmin, testLogger } from './helpers';

// FR-BILL-1, FR-BILL-7 (ADR-028): the subscription's period, and the quota counted in it.
describe('subscription periods and the quota', () => {
  // The documents' own creation time is the database's, so the clock is today's.
  const clock = fixedClock(new Date().toISOString());
  const today = ecuadorDate(clock.now());
  const keyCipher = createKeyCipher('d2'.repeat(32));
  let db: Database;
  let jobs: Jobs;
  let deps: IssueDeps;
  let org: CreatedOrganization;
  let ownerId: string;

  const actor = (tenantId: string): Promise<ActorContext> =>
    resolveActor(db, { userId: ownerId, tenantId, clock });
  const invoice = async (ctx: ActorContext) => {
    const input: InvoiceInput = {
      issuePointId: (await companySettings(ctx, db)).branches[0]!.issuePoints[0]!.id,
      clientId: null,
      lines: [{ code: 'P-1', name: 'Café', quantity: '1', unitPrice: '10', ivaRateCode: '4' }],
      payments: [{ method: '01', amount: '11.50' }],
    };
    return createInvoice(ctx, db, input, deps);
  };
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: subscription periods', ({ executeSql }) => executeSql(text, values));
  const setPeriod = (period: { start: string; end: string | null; interval: string }) =>
    sql(
      `UPDATE subscriptions SET period_start = $2, period_end = $3, interval = $4
       WHERE tenant_id = ANY($1)`,
      [[org.realTenantId, org.twinTenantId], period.start, period.end, period.interval],
    );
  const quota = (limit: number | null) =>
    setOverride(operator, db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOCUMENT_QUOTA',
      effect: 'LIMIT',
      limitValue: limit,
      reason: 'test',
    });
  let operator: Awaited<ReturnType<typeof superAdmin>>;

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    deps = {
      jobs,
      keyCipher,
      appEnv: 'local',
      providerRuc: '1712345678001',
      consumerFinalMaxAmount: '50.00',
    };
    operator = await superAdmin(db);
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `sp.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Upsilon S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2020-01-01'),
            notAfter: new Date('2040-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher, clock },
    );
    await goLive(await actor(org.realTenantId), db, { requireAgreements: false });
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('starts a company and its twin unbilled, from the day they are created', async () => {
    const { rows } = await sql(
      `SELECT interval, status, period_start::text AS start, period_end FROM subscriptions
       WHERE tenant_id = ANY($1)`,
      [[org.realTenantId, org.twinTenantId]],
    );
    expect(rows).toEqual([
      { interval: 'MONTHLY', status: 'ACTIVE', start: today, period_end: null },
      { interval: 'MONTHLY', status: 'ACTIVE', start: today, period_end: null },
    ]);
  });

  it('keeps the status machine in the database, generated from its definition', async () => {
    const { rows } = await sql(
      `SELECT prosrc FROM pg_proc WHERE proname = 'app_subscription_status_check'`,
    );
    expect((rows[0] as { prosrc: string }).prosrc).toContain(
      schema.subscriptionStatusTriggerBody(),
    );
    const move = (status: string) =>
      sql(`UPDATE subscriptions SET status = $2 WHERE tenant_id = $1`, [org.twinTenantId, status]);
    await move('CANCELLED');
    await expect(move('PAST_DUE')).rejects.toThrow(/can not become/);
    await move('ACTIVE');
  });

  it('counts the quota in the billed period, and twelve months of it for a yearly one', async () => {
    await quota(2);
    await setPeriod({ start: today, end: null, interval: 'MONTHLY' });
    const live = await actor(org.realTenantId);
    await invoice(live);
    await invoice(live);
    expect(await failure(invoice(live))).toBe('QUOTA_EXCEEDED');
    expect(await quotaUsage(await actor(org.realTenantId), db)).toMatchObject({
      used: 2,
      limit: 2,
      start: today,
    });

    // A yearly period pools the year: 2 a month is 24 up front.
    const yearEnd = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
    await setPeriod({ start: today, end: yearEnd, interval: 'YEARLY' });
    const yearly = await actor(org.realTenantId);
    await invoice(yearly);
    expect(await quotaUsage(yearly, db)).toMatchObject({ used: 3, limit: 24, end: yearEnd });
    expect((await planOverview(yearly, db)).subscription).toEqual({
      interval: 'YEARLY',
      status: 'ACTIVE',
      periodStart: today,
      periodEnd: yearEnd,
    });
  });

  it('never refreshes the quota of a period that ended unpaid, and starts afresh with a new one', async () => {
    await quota(3);
    // Ended yesterday and not renewed: today's documents still count against it.
    const lastMonth = '2026-10-01';
    await setPeriod({ start: lastMonth, end: today, interval: 'MONTHLY' });
    const late = await actor(org.realTenantId);
    expect(await failure(invoice(late))).toBe('QUOTA_EXCEEDED');
    // A period that starts tomorrow counts nothing made today.
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    await setPeriod({ start: tomorrow, end: null, interval: 'MONTHLY' });
    expect(await quotaUsage(await actor(org.realTenantId), db)).toMatchObject({
      used: 0,
      start: tomorrow,
    });
    await quota(null);
  });

  it('never counts the twin', async () => {
    const twin = await actor(org.twinTenantId);
    await invoice(twin);
    expect((await quotaUsage(twin, db)).used).toBe(0);
  });
});
