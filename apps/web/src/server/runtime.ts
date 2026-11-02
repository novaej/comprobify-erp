import 'server-only';
import { loadWebEnv, type WebEnv } from '@comprobify/config/env';
import { createLogger, type Logger } from '@comprobify/config/logger';
import {
  createAuth,
  createKeyCipher,
  createIdentity,
  createJobs,
  createRateLimiter,
  systemClock,
  type Auth,
  type EmailLocale,
  type Identity,
  type Jobs,
  type KeyCipher,
} from '@comprobify/core';
import { createDatabase, type Database } from '@comprobify/db';
import { nextCookies } from 'better-auth/next-js';

export type Runtime = {
  env: WebEnv;
  logger: Logger;
  db: Database;
  jobs: Jobs;
  identity: Identity;
  auth: Auth;
  keyCipher: KeyCipher;
};

// On globalThis: Next bundles instrumentation and routes separately, so a
// module variable would give each its own pool and pg-boss.
const holder = globalThis as { comprobifyRuntime?: Promise<Runtime> };

async function start(): Promise<Runtime> {
  const env = loadWebEnv();
  const logger = createLogger({
    service: 'web',
    level: env.LOG_LEVEL,
    pretty: env.LOG_FORMAT === 'pretty',
    betterstackSourceToken: env.BETTERSTACK_SOURCE_TOKEN,
  });
  const db = createDatabase({ connectionString: env.DATABASE_URL, logger });
  await db.assertSafeConnection();
  // Web only sends (ADR-005).
  const jobs = createJobs({ connectionString: env.DATABASE_URL, role: 'web', logger });
  await jobs.start();

  // Links point at our pages, which check on GET and consume on POST (FR-ONB-1).
  const link = (locale: EmailLocale, page: string, token: string) =>
    `${env.APP_URL}/${locale}/${page}?token=${encodeURIComponent(token)}`;
  const sendLink = async (
    to: string,
    locale: EmailLocale,
    template: 'verifyEmail' | 'resetPassword',
    url: string,
  ) => {
    await jobs.enqueueWithoutTransaction('email.send', { to, locale, template, params: { url } });
  };

  const auth = createAuth({
    db: db.identity,
    secret: env.AUTH_SECRET,
    appUrl: env.APP_URL,
    emails: {
      verification: (to, locale, token) =>
        sendLink(to, locale, 'verifyEmail', link(locale, 'verify-email', token)),
      passwordReset: (to, locale, token) =>
        sendLink(to, locale, 'resetPassword', link(locale, 'reset-password', token)),
    },
    // Sets cookies from server actions; must stay last.
    plugins: [nextCookies()],
  });
  const identity = createIdentity({
    auth,
    db: db.identity,
    rateLimiter: createRateLimiter(db.identity, () => systemClock.now()),
    clock: systemClock,
  });

  logger.info('Web started', { event: 'web.started' });
  return {
    env,
    logger,
    db,
    jobs,
    identity,
    auth,
    keyCipher: createKeyCipher(env.CERT_ENCRYPTION_KEY),
  };
}

// One per server process, started by instrumentation.ts.
export function getRuntime(): Promise<Runtime> {
  holder.comprobifyRuntime ??= start();
  return holder.comprobifyRuntime;
}
