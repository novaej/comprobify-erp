import { loadWorkerEnv } from '@comprobify/config/env';
import { createLogger } from '@comprobify/config/logger';
import {
  createJobs,
  createLogProvider,
  createMailgunProvider,
  registerHandlers,
  systemClock,
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

// Env validation allows the log provider only when APP_ENV is local.
const emailProvider =
  env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN
    ? createMailgunProvider({
        apiKey: env.MAILGUN_API_KEY,
        domain: env.MAILGUN_DOMAIN,
        region: env.MAILGUN_REGION,
        from: env.EMAIL_FROM,
      })
    : createLogProvider(logger);

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
  clock: systemClock,
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
