import { randomUUID } from 'node:crypto';
import {
  acceptInvitation,
  changeRole,
  createAuth,
  createJobs,
  createOrganization,
  createRateLimiter,
  createVerifiedUser,
  fixedClock,
  getInvitation,
  inviteMember,
  listMembers,
  listOrganizations,
  removeMember,
  resolveActor,
  revokeInvitation,
  setIssuePointAccess,
  type ActorContext,
  type Auth,
  type CreatedOrganization,
  type Jobs,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, grantSeats, testLogger } from './helpers';

// FR-USR-1, FR-ROLE-1, FR-ROLE-2, FR-ONB-6a, ADR-010. Milestone 1 gate: role restrictions.
describe('members', () => {
  const clock = fixedClock(new Date().toISOString());
  let db: Database;
  let jobs: Jobs;
  let auth: Auth;
  let org: CreatedOrganization;
  let owner: string;
  let ownerCtx: ActorContext;
  const deps = () => ({
    jobs,
    appUrl: 'http://app.test',
    rateLimiter: createRateLimiter(db.identity, () => clock.now()),
  });

  const newUser = async (email = `m.${randomUUID()}@example.com`) => {
    const { id } = await createVerifiedUser(auth, {
      name: 'Member',
      email,
      password: 'correct horse battery',
      locale: 'es',
    });
    return { id, email };
  };
  const actor = (userId: string, tenantId = org.realTenantId) =>
    resolveActor(db, { userId, tenantId, clock });

  // The token only exists in the queued email, as for a real invitee.
  const invitationToken = async (email: string): Promise<string> =>
    db.withSystem('test: read the queued invitation email', async ({ executeSql }) => {
      const { rows } = await executeSql<{ url: string }>(
        `SELECT data->'params'->>'url' AS url FROM pgboss.job
         WHERE name = 'email.send' AND data->>'to' = $1 AND data->>'template' = 'invitation'
         ORDER BY created_on DESC LIMIT 1`,
        [email],
      );
      return new URL(rows[0]!.url).searchParams.get('token')!;
    });

  const invite = async (
    email: string,
    role: 'ADMIN' | 'SALES' | 'VIEWER' = 'SALES',
    ctx = ownerCtx,
  ) => {
    await inviteMember(ctx, db, { email, role, locale: 'es' }, deps());
    return invitationToken(email);
  };

  const join = async (role: 'ADMIN' | 'SALES' | 'VIEWER' = 'SALES') => {
    const user = await newUser();
    const token = await invite(user.email, role);
    await acceptInvitation(db, { token, userId: user.id, userEmail: user.email }, clock);
    return user;
  };

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
    owner = (await newUser()).id;
    org = await createOrganization(db, {
      ownerUserId: owner,
      ruc: testRuc(),
      legalName: 'Épsilon S.A.',
      tradeName: null,
      mainAddress: 'Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
    await grantSeats(db, org);
    ownerCtx = await actor(owner);
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  describe('invitations', () => {
    it('stores only a hash of the token and emails the link in the same transaction', async () => {
      const email = `i.${randomUUID()}@example.com`;
      const token = await invite(email);
      const rows = await db.withTenant({ tenantId: org.realTenantId }, ({ db: tx }) =>
        tx.select().from(schema.invitations),
      );
      const row = rows.find((invitation) => invitation.email === email);
      expect(row).toMatchObject({ role: 'SALES', acceptedAt: null, revokedAt: null });
      expect(row!.tokenHash).not.toBe(token);
      expect(token.length).toBeGreaterThanOrEqual(43);
    });

    it('shows the invitation without using it up', async () => {
      const email = `g.${randomUUID()}@example.com`;
      const token = await invite(email);
      for (let i = 0; i < 2; i++) {
        await expect(getInvitation(db, token, clock)).resolves.toEqual({
          email,
          role: 'SALES',
          organization: 'Épsilon S.A.',
          state: 'pending',
          hasAccount: false,
        });
      }
    });

    it('replaces an open invitation for the same email', async () => {
      const email = `r.${randomUUID()}@example.com`;
      const first = await invite(email);
      const second = await invite(email, 'VIEWER');
      await expect(getInvitation(db, first, clock)).resolves.toMatchObject({ state: 'revoked' });
      await expect(getInvitation(db, second, clock)).resolves.toMatchObject({
        state: 'pending',
        role: 'VIEWER',
      });
    });

    it('can be sent from the test twin, for the same organization', async () => {
      const email = `t.${randomUUID()}@example.com`;
      const token = await invite(email, 'SALES', await actor(owner, org.twinTenantId));
      await expect(getInvitation(db, token, clock)).resolves.toMatchObject({
        organization: 'Épsilon S.A.',
      });
    });

    it('refuses inviting an existing member', async () => {
      const member = await join();
      await expect(
        inviteMember(ownerCtx, db, { email: member.email, role: 'VIEWER', locale: 'es' }, deps()),
      ).rejects.toMatchObject({
        code: 'ALREADY_MEMBER',
      });
    });

    it('accepts once, for the invited email only, into the organization and its twin', async () => {
      const user = await newUser();
      const stranger = await newUser();
      const token = await invite(user.email, 'VIEWER');

      await expect(
        acceptInvitation(db, { token, userId: stranger.id, userEmail: stranger.email }, clock),
      ).rejects.toMatchObject({ code: 'INVITATION_OTHER_EMAIL' });
      await acceptInvitation(
        db,
        { token, userId: user.id, userEmail: user.email.toUpperCase() },
        clock,
      );
      await expect(
        acceptInvitation(db, { token, userId: user.id, userEmail: user.email }, clock),
      ).rejects.toMatchObject({ code: 'INVITATION_INVALID' });

      expect((await actor(user.id)).permissions).not.toContain('users.manage');
      expect((await actor(user.id, org.twinTenantId)).tenantMode).toBe('TEST');
      await expect(listOrganizations(db, user.id)).resolves.toMatchObject([
        { realTenantId: org.realTenantId, twinTenantId: org.twinTenantId, role: 'VIEWER' },
      ]);
    });

    it('refuses a revoked or expired invitation', async () => {
      const user = await newUser();
      const token = await invite(user.email);
      const { invitations } = await listMembers(ownerCtx, db);
      await revokeInvitation(ownerCtx, db, invitations.find((row) => row.email === user.email)!.id);
      await expect(
        acceptInvitation(db, { token, userId: user.id, userEmail: user.email }, clock),
      ).rejects.toMatchObject({
        code: 'INVITATION_INVALID',
      });

      const late = await newUser();
      const lateToken = await invite(late.email);
      const later = fixedClock(new Date(Date.now() + 8 * 86_400_000).toISOString());
      await expect(getInvitation(db, lateToken, later)).resolves.toMatchObject({
        state: 'expired',
      });
      await expect(
        acceptInvitation(db, { token: lateToken, userId: late.id, userEmail: late.email }, later),
      ).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
    });
  });

  describe('permissions (FR-ROLE-3)', () => {
    it('lets only users.manage invite, change or remove', async () => {
      const viewer = await join('VIEWER');
      const viewerCtx = await actor(viewer.id);
      await expect(
        inviteMember(
          viewerCtx,
          db,
          { email: 'x@example.com', role: 'VIEWER', locale: 'es' },
          deps(),
        ),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        changeRole(viewerCtx, db, { userId: owner, role: 'VIEWER' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(listMembers(viewerCtx, db)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('protects the owner and the actor themselves', async () => {
      const admin = await join('ADMIN');
      const adminCtx = await actor(admin.id);
      await expect(
        changeRole(adminCtx, db, { userId: owner, role: 'VIEWER' }),
      ).rejects.toMatchObject({ code: 'OWNER_PROTECTED' });
      await expect(removeMember(adminCtx, db, owner)).rejects.toMatchObject({
        code: 'OWNER_PROTECTED',
      });
      await expect(
        changeRole(adminCtx, db, { userId: admin.id, role: 'VIEWER' }),
      ).rejects.toMatchObject({
        code: 'CANNOT_CHANGE_SELF',
      });
      await expect(changeRole(ownerCtx, db, { userId: admin.id, role: 'OWNER' })).rejects.toThrow();
    });
  });

  describe('changes', () => {
    it('changes a role in the organization and its twin', async () => {
      const member = await join('VIEWER');
      await changeRole(ownerCtx, db, { userId: member.id, role: 'SALES' });
      expect((await actor(member.id)).permissions).toContain('sales.manage');
      expect((await actor(member.id, org.twinTenantId)).permissions).toContain('sales.manage');
    });

    it('removes a member softly, from the organization and its twin', async () => {
      const member = await join();
      await removeMember(ownerCtx, db, member.id);
      await expect(actor(member.id)).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
      await expect(actor(member.id, org.twinTenantId)).rejects.toMatchObject({
        code: 'NOT_A_MEMBER',
      });
      await expect(listOrganizations(db, member.id)).resolves.toEqual([]);
      const { members } = await listMembers(ownerCtx, db);
      expect(members.map((row) => row.userId)).not.toContain(member.id);
    });

    it('restricts a member to issue points, mirrored in the twin by code', async () => {
      const member = await join();
      await setIssuePointAccess(ownerCtx, db, {
        userId: member.id,
        points: [{ branchCode: '001', pointCode: '001' }],
      });
      const real = await actor(member.id);
      const twin = await actor(member.id, org.twinTenantId);
      expect(real.issuePointIds).toHaveLength(1);
      expect(twin.issuePointIds).toHaveLength(1);
      expect(twin.issuePointIds![0]).not.toBe(real.issuePointIds![0]);
      expect(
        (await listMembers(ownerCtx, db)).members.find((row) => row.userId === member.id)
          ?.issuePoints,
      ).toEqual(['001-001']);

      await expect(
        setIssuePointAccess(ownerCtx, db, {
          userId: member.id,
          points: [{ branchCode: '009', pointCode: '001' }],
        }),
      ).rejects.toMatchObject({ code: 'UNKNOWN_ISSUE_POINT' });
      await setIssuePointAccess(ownerCtx, db, { userId: member.id, points: [] });
      expect((await actor(member.id)).issuePointIds).toBeNull();
    });
  });

  describe('createVerifiedUser', () => {
    it('creates a verified account that can sign in, once per email', async () => {
      const email = `v.${randomUUID()}@example.com`;
      await createVerifiedUser(auth, {
        name: 'Ana',
        email,
        password: 'correct horse battery',
        locale: 'en',
      });
      await expect(
        auth.api.signInEmail({ body: { email, password: 'correct horse battery' } }),
      ).resolves.toMatchObject({
        user: { email, emailVerified: true },
      });
      await expect(
        createVerifiedUser(auth, {
          name: 'Ana',
          email,
          password: 'another passphrase',
          locale: 'en',
        }),
      ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    });
  });
});
