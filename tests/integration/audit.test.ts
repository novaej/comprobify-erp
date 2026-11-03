import { randomUUID } from 'node:crypto';
import {
  acceptInvitation,
  changeRole,
  chooseActiveOrganization,
  createAuth,
  createJobs,
  createKeyCipher,
  createRateLimiter,
  createVerifiedUser,
  fixedClock,
  goLive,
  inviteMember,
  listAuditEvents,
  listOrganizations,
  onboardOrganization,
  recordSessionStart,
  resolveActor,
  type ActorContext,
  type Auth,
  type CreatedOrganization,
  type Jobs,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, grantSeats, testLogger } from './helpers';

// FR-NOT-4, FR-ONB-5.
describe('audit log and go-live', () => {
  const clock = fixedClock(new Date().toISOString());
  let db: Database;
  let jobs: Jobs;
  let auth: Auth;
  let org: CreatedOrganization;
  let owner: string;
  let ownerCtx: ActorContext;

  const user = async () => {
    const email = `a.${randomUUID()}@example.com`;
    const { id } = await createVerifiedUser(auth, {
      name: `User ${email.slice(2, 8)}`,
      email,
      password: 'correct horse battery',
      locale: 'es',
    });
    return { id, email };
  };
  const tokenFor = (email: string) =>
    db.withSystem('test: read the queued invitation email', async ({ executeSql }) => {
      const { rows } = await executeSql<{ url: string }>(
        `SELECT data->'params'->>'url' AS url FROM pgboss.job WHERE name = 'email.send' AND data->>'to' = $1 ORDER BY created_on DESC LIMIT 1`,
        [email],
      );
      return new URL(rows[0]!.url).searchParams.get('token')!;
    });
  const join = async (role: 'ADMIN' | 'ACCOUNTANT' | 'VIEWER') => {
    const member = await user();
    await inviteMember(
      ownerCtx,
      db,
      { email: member.email, role, locale: 'es' },
      {
        jobs,
        appUrl: 'http://app.test',
        rateLimiter: createRateLimiter(db.identity, () => clock.now()),
      },
    );
    await acceptInvitation(
      db,
      { token: await tokenFor(member.email), userId: member.id, userEmail: member.email },
      clock,
    );
    return {
      ...member,
      ctx: await resolveActor(db, { userId: member.id, tenantId: org.realTenantId, clock }),
    };
  };
  const actions = async (ctx = ownerCtx) =>
    (await listAuditEvents(ctx, db)).map((event) => event.action);

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    auth = createAuth({
      db: db.identity,
      secret: 'integration-test-secret-integration-test-secret',
      appUrl: 'http://app.test',
      emails: { verification: () => Promise.resolve(), passwordReset: () => Promise.resolve() },
    });
    owner = (await user()).id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: owner,
        ruc,
        legalName: 'Eta S.A.',
        tradeName: null,
        mainAddress: 'Loja',
        branch: { code: '001', name: 'Matriz', address: null },
        issuePointCode: '001',
        certificate: { file: createTestP12({ ruc }), password: 'secret' },
        logo: null,
      },
      { keyCipher: createKeyCipher('d'.repeat(64)), clock },
    );
    await grantSeats(db, org, owner);
    ownerCtx = await resolveActor(db, { userId: owner, tenantId: org.realTenantId, clock });
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('records the organization and its certificate in both the company and its twin', async () => {
    expect(await actions()).toEqual(
      expect.arrayContaining(['organization.created', 'certificate.uploaded']),
    );
    const twinCtx = await resolveActor(db, { userId: owner, tenantId: org.twinTenantId, clock });
    expect(await actions(twinCtx)).toEqual(
      expect.arrayContaining(['organization.created', 'certificate.uploaded']),
    );
  });

  it('records member changes in the company log, with who did it to whom', async () => {
    const member = await join('VIEWER');
    await changeRole(ownerCtx, db, { userId: member.id, role: 'ACCOUNTANT' });
    const events = await listAuditEvents(ownerCtx, db);
    expect(events.find((event) => event.action === 'member.role_changed')).toMatchObject({
      details: { role: 'ACCOUNTANT' },
      actorName: expect.any(String) as unknown,
    });
    expect(events.map((event) => event.action)).toEqual(
      expect.arrayContaining(['member.invited', 'member.joined', 'member.role_changed']),
    );
  });

  it('writes nothing for a refused change', async () => {
    const before = (await listAuditEvents(ownerCtx, db)).length;
    await expect(changeRole(ownerCtx, db, { userId: owner, role: 'VIEWER' })).rejects.toMatchObject(
      { code: 'OWNER_PROTECTED' },
    );
    expect((await listAuditEvents(ownerCtx, db)).length).toBe(before);
  });

  it('lets only audit.read see the log', async () => {
    const accountant = await join('ACCOUNTANT');
    await expect(listAuditEvents(accountant.ctx, db)).resolves.not.toHaveLength(0);
    const viewer = await join('VIEWER');
    await expect(listAuditEvents(viewer.ctx, db)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('cannot be edited or deleted by the app role', async () => {
    for (const statement of [
      "UPDATE audit_events SET action = 'session.started'",
      'DELETE FROM audit_events',
    ]) {
      await expect(
        db.withTenant({ tenantId: org.realTenantId }, ({ executeSql }) => executeSql(statement)),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('records a session once per company, however many pages it opens', async () => {
    const sessionId = randomUUID();
    for (let i = 0; i < 3; i++)
      await recordSessionStart(db, { tenantId: org.realTenantId, userId: owner, sessionId });
    await recordSessionStart(db, {
      tenantId: org.realTenantId,
      userId: owner,
      sessionId: randomUUID(),
    });
    expect((await actions()).filter((action) => action === 'session.started')).toHaveLength(2);
  });

  describe('go-live (FR-ONB-5)', () => {
    it('is refused to anyone but the owner', async () => {
      const admin = await join('ADMIN');
      await expect(goLive(admin.ctx, db)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('takes the real company live once, from the test copy too, and opens production', async () => {
      const fromTwin = await resolveActor(db, { userId: owner, tenantId: org.twinTenantId, clock });
      await expect(goLive(fromTwin, db)).resolves.toEqual({ realTenantId: org.realTenantId });
      await expect(goLive(ownerCtx, db)).rejects.toMatchObject({ code: 'ALREADY_LIVE' });

      const entries = await listOrganizations(db, owner);
      expect(entries[0]).toMatchObject({ live: true });
      expect(chooseActiveOrganization(entries, org.realTenantId)).toMatchObject({
        mode: 'PRODUCTION',
      });
      expect(await actions()).toContain('organization.went_live');
    });
  });
});
