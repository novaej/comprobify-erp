import { loadWorkerEnv } from '@comprobify/config/env';
import { createLogger } from '@comprobify/config/logger';
import { createJobs, registerHandlers } from '@comprobify/core';
import { createDatabase } from '@comprobify/db';

const env = loadWorkerEnv();
const logger = createLogger({
  service: 'worker',
  level: env.LOG_LEVEL,
  pretty: env.APP_ENV === 'local',
  betterstackSourceToken: env.BETTERSTACK_SOURCE_TOKEN,
});

const db = createDatabase({ connectionString: env.DATABASE_URL, logger });
await db.assertSafeConnection();

const jobs = createJobs({ connectionString: env.DATABASE_URL, role: 'worker', logger });
await jobs.start();
// Before handlers, so a stale schedule can't fire into them on this start.
await jobs.applySchedules();
await registerHandlers(jobs, logger);
logger.info('Worker started', { event: 'worker.started' });

async function shutdown(): Promise<void> {
  await jobs.stop();
  await db.close();
  logger.info('Worker stopped', { event: 'worker.stopped' });
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void shutdown());
}
