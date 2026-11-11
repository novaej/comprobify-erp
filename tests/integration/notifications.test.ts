import { randomUUID } from 'node:crypto';
import {
  channelsFor,
  createKeyCipher,
  fixedClock,
  listNotifications,
  markAllRead,
  markRead,
  notificationPreferences,
  notify,
  NOTIFICATIONS,
  onboardOrganization,
  resolveActor,
  reviewPayment,
  setNotificationPreference,
  startPaidPlan,
  submitProof,
  unreadCount,
  type ActorContext,
  type Catalogue,
  type CreatedOrganization,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

type Sent = { to: string; locale: string; template: string; params: Record<string, string> };

// FR-NOT-1, FR-NOT-2 (ADR-036): who is told, through which channel, and what each member sees.
describe('the notification centre', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let org: CreatedOrganization;
  let sent: Sent[] = [];
  const deps = {
    appUrl: 'https://app.test',
    jobs: {
      enqueue: (_tx: unknown, queue: string, data: unknown) => {
        if (queue === 'email.send') sent.push(data as Sent);
        return Promise.resolve(null);
      },
    },
  };
  // Four members: they see billing notices by what their role may do (billing.manage).
  const people: Record<'owner' | 'admin' | 'sales' | 'viewer', { id: string; email: string }> = {
    owner: { id: '', email: '' },
    admin: { id: '', email: '' },
    sales: { id: '', email: '' },
    viewer: { id: '', email: '' },
  };
  const as = (who: keyof typeof people, tenantId = org.realTenantId): Promise<ActorContext> =>
    resolveActor(db, { userId: people[who].id, tenantId, clock });
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: notifications', ({ executeSql }) => executeSql(text, values));
  const tell = (type: 'PAYMENT_VERIFIED' | 'RENEWAL_DUE', extra = {}) =>
    db.withSystem('test: notify', (tx) =>
      notify(tx, deps, {
        tenantId: org.realTenantId,
        type,
        params: { amount: '11.39', date: '2026-12-10' },
        ...extra,
      }),
    );
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };

  beforeAll(async () => {
    db = appDatabase();
    for (const [who, role] of [
      ['owner', 'OWNER'],
      ['admin', 'ADMIN'],
      ['sales', 'SALES'],
      ['viewer', 'VIEWER'],
    ] as const) {
      const email = `nt.${who}.${randomUUID()}@example.com`;
      const [user] = await db.identity
        .insert(schema.users)
        .values({ name: who, email, emailVerified: true, locale: who === 'admin' ? 'en' : 'es' })
        .returning({ id: schema.users.id });
      people[who] = { id: user!.id, email };
      if (who === 'owner') continue;
      void role;
    }
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: people.owner.id,
        ruc,
        legalName: 'Notificada S.A.',
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
      { keyCipher: createKeyCipher('de'.repeat(32)), clock },
    );
    for (const [who, role] of [
      ['admin', 'ADMIN'],
      ['sales', 'SALES'],
      ['viewer', 'VIEWER'],
    ] as const)
      for (const tenantId of [org.realTenantId, org.twinTenantId])
        await sql(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)`, [
          tenantId,
          people[who].id,
          role,
        ]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('keeps every catalogue entry coherent', () => {
    for (const spec of Object.values(NOTIFICATIONS)) {
      expect(spec.channels.length).toBeGreaterThan(0);
      for (const channel of spec.defaults) expect(spec.channels).toContain(channel);
      // The email template exists exactly when the email channel does.
      expect(spec.emailTemplate !== null).toBe(spec.channels.includes('EMAIL'));
      // A mandatory type is on in every channel it has.
      if (spec.mandatory) expect(spec.defaults).toEqual(spec.channels);
    }
  });

  it('tells only the members whose role can act on it, in the app and by email in their language', async () => {
    sent = [];
    await expect(tell('PAYMENT_VERIFIED')).resolves.toBe(2);
    expect(sent.map((email) => [email.to, email.locale]).sort()).toEqual(
      [
        [people.owner.email, 'es'],
        [people.admin.email, 'en'],
      ].sort(),
    );
    expect(sent.find((email) => email.to === people.owner.email)).toMatchObject({
      template: 'paymentVerified',
      params: {
        url: 'https://app.test/es/plan',
        organization: 'Notificada S.A.',
        amount: '$11.39',
        date: '10 de diciembre de 2026',
      },
    });
    expect(sent.find((email) => email.to === people.admin.email)!.params.date).toBe(
      'December 10, 2026',
    );
    // Sales and viewers hold no billing.manage: nothing for them, in either channel.
    for (const who of ['sales', 'viewer'] as const) {
      expect(await unreadCount(await as(who), db)).toBe(0);
      await expect(listNotifications(await as(who), db)).resolves.toEqual({
        items: [],
        hasMore: false,
      });
    }
    expect(await unreadCount(await as('owner'), db)).toBe(1);
  });

  it('shows a member their own notifications, from either copy of the company, and marks them read', async () => {
    await tell('RENEWAL_DUE', { environment: 'TEST' });
    // The test copy sees the company's notifications too, with where they came from.
    const owner = await as('owner', org.twinTenantId);
    const list = await listNotifications(owner, db);
    expect(list.items.map((item) => [item.type, item.environment])).toEqual([
      ['RENEWAL_DUE', 'TEST'],
      ['PAYMENT_VERIFIED', 'PRODUCTION'],
    ]);
    expect(list.items[0]).toMatchObject({
      link: '/plan',
      params: { amount: '11.39', date: '2026-12-10' },
      readAt: null,
    });
    expect(await unreadCount(owner, db)).toBe(2);

    // Read state is the member's own.
    await markRead(owner, db, [list.items[0]!.id]);
    expect(await unreadCount(owner, db)).toBe(1);
    expect(await unreadCount(await as('admin'), db)).toBe(2);
    // Marking someone else's receipt read does nothing.
    await markRead(await as('admin'), db, [list.items[1]!.id]);
    expect(await unreadCount(await as('admin'), db)).toBe(2);
    expect(await unreadCount(owner, db)).toBe(1);
    await expect(listNotifications(owner, db, { unreadOnly: true })).resolves.toMatchObject({
      items: [{ type: 'PAYMENT_VERIFIED' }],
    });
    await markAllRead(owner, db);
    expect(await unreadCount(owner, db)).toBe(0);
    // Nobody else's receipts were touched.
    expect(await unreadCount(await as('admin'), db)).toBe(2);
  });

  it('pages the list', async () => {
    const owner = await as('owner');
    const first = await listNotifications(owner, db, { pageSize: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const second = await listNotifications(owner, db, { pageSize: 1, page: 2 });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    expect(second.hasMore).toBe(false);
  });

  it('lists only the types a role receives, and honours what a member turns off', async () => {
    const owner = await as('owner');
    expect((await notificationPreferences(owner, db)).map((row) => row.type)).toContain(
      'PAYMENT_VERIFIED',
    );
    // Sales issues documents but doesn't manage billing.
    const salesTypes = (await notificationPreferences(await as('sales'), db)).map(
      (row) => row.type,
    );
    expect(salesTypes).toContain('DOCUMENT_REJECTED');
    expect(salesTypes).not.toContain('PAYMENT_VERIFIED');
    expect(
      await failure(
        setNotificationPreference(await as('sales'), db, {
          type: 'PAYMENT_VERIFIED',
          channel: 'EMAIL',
          enabled: false,
        }),
      ),
    ).toBe('NOTIFICATION_NOT_AVAILABLE');

    await setNotificationPreference(owner, db, {
      type: 'PAYMENT_VERIFIED',
      channel: 'EMAIL',
      enabled: false,
    });
    const row = (await notificationPreferences(owner, db)).find(
      (entry) => entry.type === 'PAYMENT_VERIFIED',
    )!;
    expect(row.channels).toEqual([
      { channel: 'IN_APP', enabled: true, locked: false },
      { channel: 'EMAIL', enabled: false, locked: false },
    ]);
    sent = [];
    const before = await unreadCount(owner, db);
    await tell('PAYMENT_VERIFIED');
    // No email for the owner, still the in-app one; the admin is unchanged.
    expect(sent.map((email) => email.to)).toEqual([people.admin.email]);
    expect(await unreadCount(owner, db)).toBe(before + 1);

    // In-app off too: nothing reaches the owner at all.
    await setNotificationPreference(owner, db, {
      type: 'PAYMENT_VERIFIED',
      channel: 'IN_APP',
      enabled: false,
    });
    const after = await unreadCount(owner, db);
    await expect(tell('PAYMENT_VERIFIED')).resolves.toBe(1);
    expect(await unreadCount(owner, db)).toBe(after);
    // Turned back on, it is theirs again.
    await setNotificationPreference(owner, db, {
      type: 'PAYMENT_VERIFIED',
      channel: 'IN_APP',
      enabled: true,
    });
    await setNotificationPreference(owner, db, {
      type: 'PAYMENT_VERIFIED',
      channel: 'EMAIL',
      enabled: true,
    });
    await expect(tell('PAYMENT_VERIFIED')).resolves.toBe(2);
  });

  it('keeps a member’s choices to the company they were made in', async () => {
    const { rows } = await sql(
      `SELECT count(*)::int AS n FROM notification_preferences
       WHERE user_id = ANY($2) AND tenant_id <> $1`,
      [org.realTenantId, Object.values(people).map((person) => person.id)],
    );
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('never lets a mandatory type be turned off, or a channel the type lacks be asked for', async () => {
    // Nothing is mandatory yet: the rule is tested on a catalogue that says so.
    const strict: Catalogue = {
      ...NOTIFICATIONS,
      PAYMENT_VERIFIED: { ...NOTIFICATIONS.PAYMENT_VERIFIED, mandatory: true },
      RENEWAL_DUE: {
        ...NOTIFICATIONS.RENEWAL_DUE,
        channels: ['IN_APP'],
        defaults: ['IN_APP'],
        emailTemplate: null,
      },
    };
    const owner = await as('owner');
    expect(
      await failure(
        setNotificationPreference(
          owner,
          db,
          { type: 'PAYMENT_VERIFIED', channel: 'EMAIL', enabled: false },
          strict,
        ),
      ),
    ).toBe('NOTIFICATION_MANDATORY');
    expect(
      await failure(
        setNotificationPreference(
          owner,
          db,
          { type: 'RENEWAL_DUE', channel: 'EMAIL', enabled: true },
          strict,
        ),
      ),
    ).toBe('NOTIFICATION_CHANNEL_UNAVAILABLE');
    const rows = await notificationPreferences(owner, db, strict);
    expect(rows.find((row) => row.type === 'PAYMENT_VERIFIED')!.channels).toEqual([
      { channel: 'IN_APP', enabled: true, locked: true },
      { channel: 'EMAIL', enabled: true, locked: true },
    ]);
    expect(rows.find((row) => row.type === 'RENEWAL_DUE')!.channels).toEqual([
      { channel: 'IN_APP', enabled: true, locked: false },
    ]);
    // The member's earlier choice to mute it is ignored for a mandatory type.
    await setNotificationPreference(owner, db, {
      type: 'PAYMENT_VERIFIED',
      channel: 'EMAIL',
      enabled: false,
    });
    expect(channelsFor('PAYMENT_VERIFIED', [{ channel: 'EMAIL', enabled: false }], strict)).toEqual(
      ['IN_APP', 'EMAIL'],
    );
    await setNotificationPreference(owner, db, {
      type: 'PAYMENT_VERIFIED',
      channel: 'EMAIL',
      enabled: true,
    });
  });

  it('tells the payer of the operator’s decision on a transfer: rejected with its reason, then verified', async () => {
    const operator = { ...(await superAdmin(db)), clock };
    const payer = await as('owner', org.twinTenantId);
    const payment = await startPaidPlan(payer, db, { planKey: 'STARTER', interval: 'MONTHLY' });
    const report = () =>
      submitProof(payer, db, {
        paymentId: payment.id,
        reference: 'SPI-1',
        files: [
          {
            filename: 'p.png',
            content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
          },
        ],
      });
    await report();
    sent = [];
    await reviewPayment(
      operator,
      db,
      { paymentId: payment.id, decision: 'REJECTED', reason: 'AMOUNT_MISMATCH' },
      deps,
    );
    expect(sent.map((email) => [email.to, email.template, email.params.reason]).sort()).toEqual(
      [
        [people.admin.email, 'paymentRejected', 'AMOUNT_MISMATCH'],
        [people.owner.email, 'paymentRejected', 'AMOUNT_MISMATCH'],
      ].sort(),
    );
    const latest = (await listNotifications(await as('owner'), db)).items[0]!;
    expect(latest).toMatchObject({
      type: 'PAYMENT_REJECTED',
      params: { amount: '11.39', reason: 'AMOUNT_MISMATCH' },
    });

    await report();
    sent = [];
    await reviewPayment(operator, db, { paymentId: payment.id, decision: 'VERIFIED' }, deps);
    expect(sent.map((email) => email.template)).toEqual(['paymentVerified', 'paymentVerified']);
    expect((await listNotifications(await as('admin'), db)).items[0]).toMatchObject({
      type: 'PAYMENT_VERIFIED',
      params: { amount: '11.39', code: payment.code },
    });
  });

  it('never shows one company’s notifications to a member of another', async () => {
    const [stranger] = await db.identity
      .insert(schema.users)
      .values({ name: 'Otra', email: `nt.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    const ruc = testRuc();
    const other = await onboardOrganization(
      db,
      {
        ownerUserId: stranger!.id,
        ruc,
        legalName: 'Otra S.A.',
        tradeName: null,
        mainAddress: 'Cuenca',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Cuenca' },
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
      { keyCipher: createKeyCipher('de'.repeat(32)), clock },
    );
    const mine = await resolveActor(db, {
      userId: stranger!.id,
      tenantId: other.realTenantId,
      clock,
    });
    await expect(listNotifications(mine, db)).resolves.toEqual({ items: [], hasMore: false });
    expect(await unreadCount(mine, db)).toBe(0);
  });
});
