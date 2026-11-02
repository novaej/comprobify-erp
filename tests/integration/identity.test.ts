import { randomUUID } from 'node:crypto';
import {
  createAuth,
  createIdentity,
  createRateLimiter,
  fixedClock,
  pruneIdentityTables,
  type Auth,
  type Identity,
} from '@comprobify/core';
import { eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appDatabase } from './helpers';

// FR-ONB-1, FR-ONB-7, FR-USR-2, FR-USR-4, ADR-009.
describe('identity', () => {
  const clock = fixedClock(new Date().toISOString());
  const sent: Record<string, string> = {};
  let db: Database;
  let auth: Auth;
  let identity: Identity;

  const meta = (cookie = '') => ({
    ip: `198.51.100.${Math.floor(Math.random() * 250)}-${randomUUID()}`,
    headers: new Headers(cookie ? { cookie } : {}),
  });
  const newEmail = () => `User.${randomUUID()}@Example.com`;
  const password = 'correct horse battery';

  // Better Auth's own sign-in, to get a cookie the way the browser would.
  const cookieFor = async (email: string, pw = password): Promise<string> => {
    const result = await auth.api.signInEmail({
      body: { email, password: pw },
      returnHeaders: true,
    });
    return result.headers.get('set-cookie')?.split(';')[0] ?? '';
  };

  const verifiedUser = async (): Promise<string> => {
    const email = newEmail();
    await identity.signUp({ name: 'Ana', email, password, locale: 'es' }, meta());
    await identity.verifyEmail({ token: sent[`verify:${email.toLowerCase()}`]! }, meta());
    return email.toLowerCase();
  };

  beforeAll(() => {
    db = appDatabase();
    auth = createAuth({
      db: db.identity,
      secret: 'integration-test-secret-integration-test-secret',
      appUrl: 'http://localhost:3000',
      emails: {
        verification: (to, _locale, token) => {
          sent[`verify:${to}`] = token;
          return Promise.resolve();
        },
        passwordReset: (to, _locale, token) => {
          sent[`reset:${to}`] = token;
          return Promise.resolve();
        },
      },
    });
    identity = createIdentity({
      auth,
      db: db.identity,
      rateLimiter: createRateLimiter(db.identity, () => clock.now()),
      clock,
    });
  });

  beforeEach(() => clock.set(new Date().toISOString()));

  afterAll(() => db.close());

  it('signs up with a lower-cased email, a uuidv7 id and the locale', async () => {
    const email = newEmail();
    await identity.signUp({ name: 'Ana', email, password, locale: 'en' }, meta());
    const [user] = await db.identity
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase()));
    expect(user).toMatchObject({
      email: email.toLowerCase(),
      locale: 'en',
      emailVerified: false,
      isSuperAdmin: false,
    });
    expect(user?.id[14]).toBe('7');
  });

  it('refuses sign-in until the email is verified, then allows it', async () => {
    const email = newEmail();
    await identity.signUp({ name: 'Ana', email, password, locale: 'es' }, meta());
    await expect(identity.signIn({ email, password }, meta())).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
    });
    await identity.verifyEmail({ token: sent[`verify:${email.toLowerCase()}`]! }, meta());
    await expect(identity.signIn({ email, password }, meta())).resolves.toEqual({
      twoFactorRequired: false,
    });
  });

  // Better Auth answers a duplicate like a new sign-up, so the form can't reveal
  // which emails have accounts. Nothing is created, sent or changed.
  it('treats a duplicate email like a new sign-up without touching the account', async () => {
    const email = await verifiedUser();
    delete sent[`verify:${email}`];
    await expect(
      identity.signUp(
        { name: 'Intruder', email, password: 'another passphrase', locale: 'en' },
        meta(),
      ),
    ).resolves.toBeUndefined();
    const users = await db.identity
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ name: 'Ana', locale: 'es', emailVerified: true });
    expect(sent[`verify:${email}`]).toBeUndefined();
    await expect(identity.signIn({ email, password }, meta())).resolves.toEqual({
      twoFactorRequired: false,
    });
  });

  it('refuses a short password before reaching Better Auth', async () => {
    await expect(
      identity.signUp({ name: 'Ana', email: newEmail(), password: 'short', locale: 'es' }, meta()),
    ).rejects.toThrow();
  });

  it('rate-limits sign-in by email after five failures, even with the right password', async () => {
    const email = await verifiedUser();
    for (let i = 0; i < 5; i++) {
      await expect(
        identity.signIn({ email, password: 'wrong password!' }, meta()),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    }
    await expect(identity.signIn({ email, password }, meta())).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('limits sign-ups per IP address when the proxy reports one', async () => {
    const ip = `203.0.113.${randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      await identity.signUp(
        { name: 'Ana', email: newEmail(), password, locale: 'es' },
        { ip, headers: new Headers() },
      );
    }
    await expect(
      identity.signUp(
        { name: 'Ana', email: newEmail(), password, locale: 'es' },
        { ip, headers: new Headers() },
      ),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    // Local development reports no address: only the per-email limits apply.
    await expect(
      identity.signUp(
        { name: 'Ana', email: newEmail(), password, locale: 'es' },
        { ip: null, headers: new Headers() },
      ),
    ).resolves.toBeUndefined();
  });

  it('reads an active session without extending it, and ends it when idle', async () => {
    const email = await verifiedUser();
    const cookie = await cookieFor(email);
    const headers = new Headers({ cookie });

    const active = await identity.currentSession(headers);
    expect(active).toMatchObject({
      status: 'active',
      user: { email, locale: 'es', isSuperAdmin: false },
    });
    // Verifying the email also signs in, so the user has more than one session.
    const sessionId = active.status === 'active' ? active.sessionId : '';
    const [before] = await db.identity
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId));

    clock.set(new Date(Date.now() + 29 * 60_000).toISOString());
    await identity.currentSession(headers);
    const [after] = await db.identity
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, before!.id));
    expect(after?.lastActivityAt).toEqual(before?.lastActivityAt);
    expect(after?.expiresAt).toEqual(before?.expiresAt);

    clock.set(new Date(Date.now() + 31 * 60_000).toISOString());
    await expect(identity.currentSession(headers)).resolves.toEqual({ status: 'idle' });
    const gone = await db.identity
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, before!.id));
    expect(gone).toHaveLength(0);
  });

  it('records real activity, at most once a minute, and never revives an idle session', async () => {
    const email = await verifiedUser();
    const headers = new Headers({ cookie: await cookieFor(email) });
    const state = await identity.currentSession(headers);
    const sessionId = state.status === 'active' ? state.sessionId : '';
    const lastActivity = async () =>
      (await db.identity.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)))[0]
        ?.lastActivityAt;

    const start = await lastActivity();
    clock.set(new Date(Date.now() + 30_000).toISOString());
    await identity.recordActivity(headers);
    expect(await lastActivity()).toEqual(start);

    clock.set(new Date(Date.now() + 20 * 60_000).toISOString());
    await identity.recordActivity(headers);
    expect((await lastActivity())!.getTime()).toBeGreaterThan(start!.getTime());

    clock.set(new Date(Date.now() + 120 * 60_000).toISOString());
    const stale = await lastActivity();
    await identity.recordActivity(headers);
    expect(await lastActivity()).toEqual(stale);
  });

  it('signs out everywhere', async () => {
    const email = await verifiedUser();
    const first = await cookieFor(email);
    await cookieFor(email);
    const [user] = await db.identity
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    await identity.signOutEverywhere(meta(first));
    const left = await db.identity
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user!.id));
    expect(left).toHaveLength(0);
  });

  it('resets a password once per token and revokes existing sessions', async () => {
    const email = await verifiedUser();
    await cookieFor(email);
    await identity.requestPasswordReset({ email }, meta());
    const token = sent[`reset:${email}`]!;

    await identity.resetPassword({ token, password: 'a brand new passphrase' }, meta());
    await expect(
      identity.resetPassword({ token, password: 'yet another passphrase' }, meta()),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });

    const [user] = await db.identity
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    const sessions = await db.identity
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user!.id));
    expect(sessions).toHaveLength(0);
    await expect(
      identity.signIn({ email, password: 'a brand new passphrase' }, meta()),
    ).resolves.toEqual({ twoFactorRequired: false });
  });

  it('answers a reset request for an unknown email the same way', async () => {
    await expect(
      identity.requestPasswordReset({ email: newEmail() }, meta()),
    ).resolves.toBeUndefined();
  });

  it('prunes expired sessions, tokens and old rate-limit hits', async () => {
    const limiter = createRateLimiter(
      db.identity,
      () => new Date(Date.now() - 3 * 24 * 60 * 60_000),
    );
    await limiter.hit('sign-up:ip', randomUUID());
    const pruned = await pruneIdentityTables(db.identity, limiter, new Date());
    expect(pruned.rateLimitHits).toBeGreaterThanOrEqual(1);
  });

  it('gives the app role DELETE only on the credential tables (ADR-009)', async () => {
    const rows = await db.withSystem('privilege check', async (tx) => {
      const { rows } = await tx.executeSql<{ table_name: string }>(
        `SELECT table_name FROM information_schema.table_privileges
         WHERE grantee = current_user AND privilege_type = 'DELETE' AND table_schema = 'public'
         ORDER BY 1`,
      );
      return rows.map((row) => row.table_name);
    });
    expect(rows).toEqual(['rate_limit_hits', 'sessions', 'two_factors', 'verifications']);
  });
});
