import { randomUUID } from 'node:crypto';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import {
  createAuth,
  createIdentity,
  createOrganization,
  createRateLimiter,
  createVerifiedUser,
  fixedClock,
  listOrganizations,
  resolveActor,
  setTwoFactorRequirement,
  type Auth,
  type Identity,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import type { Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase } from './helpers';

// FR-USR-3, ADR-009.
describe('two-factor sign-in', () => {
  const clock = fixedClock(new Date().toISOString());
  const password = 'correct horse battery';
  let db: Database;
  let auth: Auth;
  let identity: Identity;

  const cookieOf = (headers: Headers) =>
    (headers.getSetCookie?.() ?? [headers.get('set-cookie') ?? ''])
      .map((cookie) => cookie.split(';')[0])
      .filter(Boolean)
      .join('; ');
  const meta = (cookie: string) => ({ ip: null, headers: new Headers({ cookie }) });
  const codeFor = (totpUri: string) =>
    createOTP(
      new TextDecoder().decode(base32.decode(new URL(totpUri).searchParams.get('secret')!)),
    ).totp();

  // The first step of sign-in leaves only the short-lived two-factor cookie.
  const firstStep = async (email: string) => {
    const result = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
    return { response: result.response, cookie: cookieOf(result.headers) };
  };

  // A user with TOTP confirmed. Confirming replaces the session, as Better Auth
  // rotates it, so a fresh one comes from a full sign-in: password, then code.
  const userWithTwoFactor = async () => {
    const email = `tf.${randomUUID()}@example.com`;
    const { id } = await createVerifiedUser(auth, { name: 'Tere', email, password, locale: 'es' });
    const signedIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
    const setup = await identity.startTwoFactorSetup(
      { password },
      meta(cookieOf(signedIn.headers)),
    );
    await identity.confirmTwoFactorSetup(
      { code: await codeFor(setup.totpUri) },
      meta(cookieOf(signedIn.headers)),
    );
    const { cookie } = await firstStep(email);
    const verified = await auth.api.verifyTOTP({
      body: { code: await codeFor(setup.totpUri) },
      headers: new Headers({ cookie }),
      returnHeaders: true,
    });
    return { id, email, session: cookieOf(verified.headers), setup };
  };

  beforeAll(() => {
    db = appDatabase();
    auth = createAuth({
      db: db.identity,
      secret: 'integration-test-secret-integration-test-secret',
      appUrl: 'http://app.test',
      emails: { verification: () => Promise.resolve(), passwordReset: () => Promise.resolve() },
    });
    identity = createIdentity({
      auth,
      db: db.identity,
      rateLimiter: createRateLimiter(db.identity, () => clock.now()),
      clock,
    });
  });

  afterAll(() => db.close());

  it('stays off until a code from the app is confirmed', async () => {
    const email = `half.${randomUUID()}@example.com`;
    await createVerifiedUser(auth, { name: 'Ana', email, password, locale: 'es' });
    const signedIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
    await identity.startTwoFactorSetup({ password }, meta(cookieOf(signedIn.headers)));
    await expect(identity.signIn({ email, password }, meta(''))).resolves.toEqual({
      twoFactorRequired: false,
    });
  });

  it('refuses setup with the wrong password', async () => {
    const email = `wp.${randomUUID()}@example.com`;
    await createVerifiedUser(auth, { name: 'Ana', email, password, locale: 'es' });
    const signedIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
    await expect(
      identity.startTwoFactorSetup(
        { password: 'not my password' },
        meta(cookieOf(signedIn.headers)),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('asks for a code at sign-in, and opens a session only with a valid one', async () => {
    const { email, setup } = await userWithTwoFactor();
    await expect(identity.signIn({ email, password }, meta(''))).resolves.toEqual({
      twoFactorRequired: true,
    });

    const { cookie } = await firstStep(email);
    await expect(auth.api.getSession({ headers: new Headers({ cookie }) })).resolves.toBeNull();
    await expect(
      identity.verifyTwoFactor({ code: '000000', backup: false }, meta(cookie)),
    ).rejects.toMatchObject({
      code: 'INVALID_CODE',
    });
    await identity.verifyTwoFactor(
      { code: await codeFor(setup.totpUri), backup: false },
      meta(cookie),
    );
  });

  it('accepts each backup code once', async () => {
    const { email, setup } = await userWithTwoFactor();
    const backup = setup.backupCodes[0]!;
    await identity.verifyTwoFactor(
      { code: backup, backup: true },
      meta((await firstStep(email)).cookie),
    );
    await expect(
      identity.verifyTwoFactor(
        { code: backup, backup: true },
        meta((await firstStep(email)).cookie),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CODE' });
  });

  // Each sign-in attempt allows only a few codes; the account itself locks after ten
  // wrong ones across attempts, then refuses even a correct code.
  it('locks the account after ten wrong codes across sign-in attempts', async () => {
    const { email, setup } = await userWithTwoFactor();
    for (let i = 0; i < 10; i++) {
      await expect(
        identity.verifyTwoFactor(
          { code: '000000', backup: false },
          meta((await firstStep(email)).cookie),
        ),
      ).rejects.toMatchObject({
        code:
          i < 9
            ? 'INVALID_CODE'
            : (expect.stringMatching(/INVALID_CODE|TWO_FACTOR_LOCKED/) as unknown),
      });
    }
    await expect(
      identity.verifyTwoFactor(
        { code: await codeFor(setup.totpUri), backup: false },
        meta((await firstStep(email)).cookie),
      ),
    ).rejects.toMatchObject({ code: 'TWO_FACTOR_LOCKED' });
  });

  it('turns off only with the password', async () => {
    const { email, session } = await userWithTwoFactor();
    await expect(
      identity.disableTwoFactor({ password: 'not my password' }, meta(session)),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    await identity.disableTwoFactor({ password }, meta(session));
    await expect(identity.signIn({ email, password }, meta(''))).resolves.toEqual({
      twoFactorRequired: false,
    });
  });

  it('lets the organization require it, in the organization and its twin', async () => {
    const owner = await createVerifiedUser(auth, {
      name: 'Owner',
      email: `o.${randomUUID()}@example.com`,
      password,
      locale: 'es',
    });
    const org = await createOrganization(db, {
      ownerUserId: owner.id,
      ruc: testRuc(),
      legalName: 'Zeta S.A.',
      tradeName: null,
      mainAddress: 'Cuenca',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
    const ctx = await resolveActor(db, { userId: owner.id, tenantId: org.twinTenantId, clock });
    await setTwoFactorRequirement(ctx, db, true);
    await expect(listOrganizations(db, owner.id)).resolves.toMatchObject([
      { requireTwoFactor: true },
    ]);
    await expect(
      setTwoFactorRequirement({ ...ctx, permissions: ['users.read'] }, db, false),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
