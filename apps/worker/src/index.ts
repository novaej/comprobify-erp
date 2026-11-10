import { emailProviderOf, loadWorkerEnv } from '@comprobify/config/env';
import { createLogger } from '@comprobify/config/logger';
import {
  createJobs,
  createLogProvider,
  createKeyCipher,
  createMailgunProvider,
  createMockSri,
  createNoEmailProvider,
  createSriClient,
  registerHandlers,
  systemClock,
  withRedirect,
  withTestBanner,
} from '@comprobify/core';
import { createDatabase } from '@comprobify/db';
import * as Sentry from '@sentry/node';

const env = loadWorkerEnv();
const logger = createLogger({
  service: 'worker',
  level: env.LOG_LEVEL,
  pretty: env.LOG_FORMAT === 'pretty',
  betterstackSourceToken: env.BETTERSTACK_SOURCE_TOKEN,
});

if (env.SENTRY_DSN) {
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.APP_ENV, tracesSampleRate: 0.2 });
}

const db = createDatabase({ connectionString: env.DATABASE_URL, logger });
await db.assertSafeConnection();

// ADR-015. The env allows log only locally and the redirect never in production.
const provider = emailProviderOf(env);
let emailProvider =
  provider === 'mailgun'
    ? createMailgunProvider({
        apiKey: env.MAILGUN_API_KEY!,
        domain: env.MAILGUN_DOMAIN!,
        region: env.MAILGUN_REGION,
        from: env.EMAIL_FROM,
        documentsFrom: env.EMAIL_FROM_DOCUMENTS,
      })
    : provider === 'log'
      ? createLogProvider(logger)
      : createNoEmailProvider();
if (provider === 'none') logger.warn('Email is off: nothing is sent', { event: 'email.off' });
if (env.EMAIL_REDIRECT_TO) {
  emailProvider = withRedirect(emailProvider, env.EMAIL_REDIRECT_TO);
  logger.warn('Every email goes to the test recipient', { event: 'email.redirected' });
}
if (env.APP_ENV === 'staging') emailProvider = withTestBanner(emailProvider);

// ADR-014: the mock answers like SRI; the env refuses it in production.
const sri = env.SRI_MOCK_MODE
  ? createSriClient({ transport: createMockSri().transport })
  : createSriClient({
      baseUrls: {
        ...(env.SRI_TEST_URL ? { '1': env.SRI_TEST_URL } : {}),
        ...(env.SRI_PRODUCTION_URL ? { '2': env.SRI_PRODUCTION_URL } : {}),
      },
      timeoutMs: env.SRI_TIMEOUT_MS,
    });
if (env.SRI_MOCK_MODE) logger.warn('SRI mock mode: nothing is sent to SRI', { event: 'sri.mock' });

const jobs = createJobs({
  connectionString: env.DATABASE_URL,
  role: 'worker',
  logger,
  reportError: (err) => Sentry.captureException(err),
});
await jobs.start();
// Before handlers, so a stale schedule can't fire into them on this start.
await jobs.applySchedules();
await registerHandlers(jobs, {
  logger,
  emailProvider,
  identityDb: db.identity,
  db,
  sri,
  keyCipher: createKeyCipher(env.CERT_ENCRYPTION_KEY),
  clock: systemClock,
  issue: {
    appEnv: env.APP_ENV,
    providerRuc: env.OPERATOR_RUC ?? null,
    consumerFinalMaxAmount: env.CONSUMER_FINAL_MAX_AMOUNT,
  },
  billing: { ivaRate: env.IVA_RATE, appUrl: env.APP_URL },
});
logger.info('Worker started', { event: 'worker.started' });

async function shutdown(): Promise<void> {
  await jobs.stop();
  await db.close();
  await Sentry.close(2000);
  logger.info('Worker stopped', { event: 'worker.stopped' });
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void shutdown());
}
