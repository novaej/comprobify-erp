import 'server-only';
import { hostname } from 'node:os';
import { loadWebEnv, type WebEnv } from '@comprobify/config/env';
import { createLogger, type Logger } from '@comprobify/config/logger';
import {
  createAuth,
  createKeyCipher,
  createMockSri,
  createSriClient,
  createIdentity,
  createJobs,
  createRateLimiter,
  systemClock,
  type AgreementParties,
  type Auth,
  type EmailLocale,
  type Identity,
  type IssueDeps,
  type Jobs,
  type SriClient,
  type KeyCipher,
  type BillingDeps,
  createPayphoneGateway,
  type PayphoneDeps,
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
  // What createInvoice and correctInvoice need from config (FR-DOC-2, FR-DOC-9).
  issueDeps: IssueDeps;
  billingDeps: BillingDeps;
  // Null when Payphone isn't set up: card payments are refused (ADR-033).
  payphoneDeps: PayphoneDeps;
  // For voiding: Consulta de validez (FR-DOC-8).
  sri: SriClient;
  // Null while the legal texts are under review (AGREEMENTS_ENABLED=false).
  agreementParties: AgreementParties | null;
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
  const keyCipher = createKeyCipher(env.CERT_ENCRYPTION_KEY);
  return {
    env,
    logger,
    db,
    jobs,
    identity,
    auth,
    keyCipher,
    // ADR-014. The web's mock never sent anything, so it reads unknown keys as voided.
    sri: env.SRI_MOCK_MODE
      ? createSriClient({ transport: createMockSri({ unknownKeys: 'VOIDED' }).transport })
      : createSriClient({
          baseUrls: {
            ...(env.SRI_TEST_URL ? { '1': env.SRI_TEST_URL } : {}),
            ...(env.SRI_PRODUCTION_URL ? { '2': env.SRI_PRODUCTION_URL } : {}),
          },
          timeoutMs: env.SRI_TIMEOUT_MS,
        }),
    billingDeps: { ivaRate: env.IVA_RATE },
    payphoneDeps: env.PAYPHONE_TOKEN
      ? {
          gateway: createPayphoneGateway({
            token: env.PAYPHONE_TOKEN,
            baseUrl: env.PAYPHONE_API_URL,
            timeoutMs: env.PAYPHONE_CONFIRM_TIMEOUT_MS,
          }),
          token: env.PAYPHONE_TOKEN,
          storeId: env.PAYPHONE_STORE_ID!,
          production: env.APP_ENV === 'production',
          instance: hostname(),
        }
      : null,
    issueDeps: {
      jobs,
      keyCipher,
      appEnv: env.APP_ENV,
      providerRuc: env.OPERATOR_RUC ?? null,
      consumerFinalMaxAmount: env.CONSUMER_FINAL_MAX_AMOUNT,
    },
    // Env validation guarantees these when agreements are on.
    agreementParties: env.AGREEMENTS_ENABLED
      ? {
          operator: {
            name: env.OPERATOR_NAME!,
            ruc: env.OPERATOR_RUC!,
            address: env.OPERATOR_ADDRESS!,
            supportEmail: env.SUPPORT_EMAIL!,
          },
        }
      : null,
  };
}

// One per server process, started by instrumentation.ts.
export function getRuntime(): Promise<Runtime> {
  holder.comprobifyRuntime ??= start();
  return holder.comprobifyRuntime;
}
