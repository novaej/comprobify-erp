import { randomUUID } from 'node:crypto';
import {
  buyAddOn,
  cancelSubscription,
  createKeyCipher,
  fixedClock,
  onboardOrganization,
  requestSeats,
  resolveActor,
  reviewPayment,
  runBillingDay,
  startPaidPlan,
  submitProof,
  type ActorContext,
  type BillingDayDeps,
  type ChangeResult,
  type CreatedOrganization,
  type PlatformActor,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin, testLogger, testNotice } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

type Sent = { to: string; template: string; params: Record<string, string | undefined> };

// FR-BILL-5 (ADR-032): the renewal cycle on a fake clock. Companies start Emprende monthly on
// 10 November 2026: the renewal opens on 3 December, the grace runs from 10 to 17 December,
// past due until 31 December, then Gratis.
describe('the daily billing job', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let operator: PlatformActor;
  let sent: Sent[] = [];
  let deps: BillingDayDeps;

  type Company = { org: CreatedOrganization; ownerId: string; email: string };
  const companies: Company[] = [];

  const at = (date: string) => clock.set(`${date}T11:00:00Z`);
  const run = () => runBillingDay(deps);
  const owner = (company: Company, tenantId = company.org.twinTenantId): Promise<ActorContext> =>
    resolveActor(db, { userId: company.ownerId, tenantId, clock });
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: the daily billing job', ({ executeSql }) => executeSql(text, values));
  const emailsTo = (company: Company) =>
    sent.filter((email) => email.to === company.email).map((email) => email.template);
  const subscription = async (company: Company) =>
    (
      await sql(
        `SELECT p.key AS plan, s.status, s.period_start::text AS start, s.period_end::text AS "end",
                s.extra_seats AS seats
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1`,
        [company.org.realTenantId],
      )
    ).rows[0];
  const renewalOf = async (company: Company) =>
    (
      await sql(
        `SELECT id, status, total_amount AS total FROM payments
         WHERE tenant_id = $1 AND purpose = 'RENEWAL' ORDER BY created_at DESC LIMIT 1`,
        [company.org.realTenantId],
      )
    ).rows[0] as { id: string; status: string; total: string } | undefined;
  const report = async (company: Company, paymentId: string) =>
    submitProof(
      await owner(company),
      db,
      {
        paymentId,
        reference: 'SPI-1',
        files: [{ filename: 'p.png', content: PNG }],
      },
      testNotice,
    );
  const pay = async (company: Company, paymentId: string) => {
    await report(company, paymentId);
    await reviewPayment(
      { ...operator, clock },
      db,
      { paymentId, decision: 'VERIFIED' },
      testNotice,
    );
  };
  const paymentOf = (result: ChangeResult) => (result.applied === 'NOW' ? result.payment! : null);

  const newCompany = async (name: string): Promise<Company> => {
    const email = `bd.${randomUUID()}@example.com`;
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email, emailVerified: true })
      .returning({ id: schema.users.id });
    const ruc = testRuc();
    const org = await onboardOrganization(
      db,
      {
        ownerUserId: user!.id,
        ruc,
        legalName: name,
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
      { keyCipher: createKeyCipher('d6'.repeat(32)), clock },
    );
    const company = { org, ownerId: user!.id, email };
    const initial = await startPaidPlan(await owner(company), db, {
      planKey: 'STARTER',
      interval: 'MONTHLY',
    });
    await pay(company, initial.id);
    companies.push(company);
    return company;
  };

  let late: Company;
  let onTime: Company;
  let leaving: Company;
  let inReview: Company;

  beforeAll(async () => {
    db = appDatabase();
    operator = await superAdmin(db);
    deps = {
      db,
      clock,
      logger: testLogger(),
      appUrl: 'https://app.test',
      jobs: {
        enqueue: (_tx, queue, data) => {
          if (queue === 'email.send') sent.push(data as Sent);
          return Promise.resolve(null);
        },
      },
    };
    at('2026-11-10');
    late = await newCompany('Late S.A.');
    onTime = await newCompany('On Time S.A.');
    leaving = await newCompany('Leaving S.A.');
    inReview = await newCompany('In Review S.A.');
    // Paid extras that must not outlive the plan.
    await pay(late, paymentOf(await requestSeats(await owner(late), db, { extraSeats: 2 }))!.id);
    await pay(
      late,
      paymentOf(await buyAddOn(await owner(late), db, { moduleKey: 'DELIVERY_GUIDES' }))!.id,
    );
    await cancelSubscription(await owner(leaving), db);
  });

  beforeEach(() => {
    sent = [];
  });

  afterAll(async () => {
    await db.close();
  });

  it('does nothing before the renewal is due', async () => {
    at('2026-12-02');
    await run();
    for (const company of companies) expect(emailsTo(company)).toEqual([]);
    expect(await renewalOf(late)).toBeUndefined();
  });

  it('opens the renewal a week ahead and tells the owner once, never for a cancelled company', async () => {
    at('2026-12-03');
    await run();
    // Emprende 9.90 + Guías 5.00 + 2 seats 8.00 = 22.90, plus IVA.
    expect(await renewalOf(late)).toMatchObject({ status: 'PENDING', total: '26.34' });
    expect(emailsTo(late)).toEqual(['renewalDue']);
    expect(sent.find((email) => email.to === late.email)!.params).toMatchObject({
      url: 'https://app.test/es/plan',
      organization: 'Late S.A.',
      amount: '$26.34',
      date: '10 de diciembre de 2026',
    });
    expect(await renewalOf(leaving)).toBeUndefined();
    expect(emailsTo(leaving)).toEqual([]);
    await run();
    expect(emailsTo(late)).toEqual(['renewalDue']);
    // The same step is in the app for the owner (ADR-036), once.
    const { rows } = await sql(
      `SELECT n.type, count(r.id)::int AS receipts FROM notifications n
       LEFT JOIN notification_receipts r ON r.notification_id = n.id
       WHERE n.tenant_id = $1 AND n.type = 'RENEWAL_DUE' GROUP BY n.type`,
      [late.org.realTenantId],
    );
    expect(rows).toEqual([{ type: 'RENEWAL_DUE', receipts: 1 }]);
  });

  it('starts the grace at the period end, with full access, and says so once', async () => {
    at('2026-12-11');
    await pay(onTime, (await renewalOf(onTime))!.id);
    await report(inReview, (await renewalOf(inReview))!.id);
    await run();
    await run();
    expect(emailsTo(late)).toEqual(['graceStarted']);
    expect((await owner(late)).standing).toBe('GOOD');
    // Paid in the grace: on time, from the old end.
    expect(emailsTo(onTime)).toEqual([]);
    expect(await subscription(onTime)).toMatchObject({
      status: 'ACTIVE',
      start: '2026-12-10',
      end: '2027-01-10',
    });
    // Cancelled: back to Gratis at the period end, nothing owed.
    expect(emailsTo(leaving)).toEqual(['movedToFree']);
    expect(await subscription(leaving)).toMatchObject({ plan: 'FREE', end: null });
  });

  it('makes an unpaid company past due when the grace ends, twin included', async () => {
    at('2026-12-17');
    await run();
    expect(emailsTo(late)).toEqual(['pastDue']);
    expect(sent.find((email) => email.to === late.email)!.params.date).toBe(
      '31 de diciembre de 2026',
    );
    for (const tenantId of [late.org.realTenantId, late.org.twinTenantId])
      expect((await owner(late, tenantId)).standing).toBe('PAST_DUE');
    // A reported transfer is the operator's to judge, not the job's.
    expect(emailsTo(inReview)).toEqual([]);
    expect((await owner(inReview)).standing).toBe('GOOD');
    await run();
    expect(emailsTo(late)).toEqual(['pastDue']);
  });

  it('moves a company still unpaid to Gratis, dropping what it paid for', async () => {
    at('2026-12-31');
    await run();
    expect(emailsTo(late)).toEqual(['movedToFree']);
    expect(await subscription(late)).toMatchObject({
      plan: 'FREE',
      status: 'ACTIVE',
      start: '2026-12-10',
      end: null,
      seats: 0,
    });
    expect(await renewalOf(late)).toMatchObject({ status: 'CANCELLED' });
    const ctx = await owner(late);
    expect(ctx.standing).toBe('GOOD');
    expect(ctx.entitlements.features).not.toContain('DOC_TYPE_06');
    sent = [];
    await run();
    expect(emailsTo(late)).toEqual([]);
  });

  it('lets the reviewed company follow the cycle once its transfer is rejected', async () => {
    const renewal = (await renewalOf(inReview))!;
    await reviewPayment(
      { ...operator, clock },
      db,
      {
        paymentId: renewal.id,
        decision: 'REJECTED',
        reason: 'TRANSFER_NOT_FOUND',
      },
      testNotice,
    );
    await run();
    expect(emailsTo(inReview)).toEqual(['pastDue']);
    // Its 14 days run from today, not from the end of a grace the review held open.
    at('2027-01-13');
    await run();
    expect(emailsTo(inReview)).toEqual(['pastDue']);
    at('2027-01-14');
    await run();
    expect(emailsTo(inReview)).toEqual(['pastDue', 'movedToFree']);
    const { rows } = await sql(
      `SELECT action FROM audit_events WHERE tenant_id = $1 AND action LIKE 'subscription.%'
         AND actor_user_id IS NULL ORDER BY occurred_at`,
      [late.org.realTenantId],
    );
    expect(rows.map((row) => (row as { action: string }).action)).toEqual([
      'subscription.renewal_due',
      'subscription.grace_started',
      'subscription.past_due',
      'subscription.moved_to_free',
    ]);
  });
});
