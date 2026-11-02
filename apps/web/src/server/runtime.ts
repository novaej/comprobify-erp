import 'server-only';
import { loadWebEnv, type WebEnv } from '@comprobify/config/env';
import { createLogger, type Logger } from '@comprobify/config/logger';
import { createJobs, type Jobs } from '@comprobify/core';
import { createDatabase, type Database } from '@comprobify/db';

export type Runtime = { env: WebEnv; logger: Logger; db: Database; jobs: Jobs };

// On globalThis: Next bundles instrumentation and routes separately, so a
// module variable would give each its own pool and pg-boss.
const holder = globalThis as { comprobifyRuntime?: Promise<Runtime> };

async function start(): Promise<Runtime> {
  const env = loadWebEnv();
  const logger = createLogger({
    service: 'web',
    level: env.LOG_LEVEL,
    pretty: env.APP_ENV === 'local',
    betterstackSourceToken: env.BETTERSTACK_SOURCE_TOKEN,
  });
  const db = createDatabase({ connectionString: env.DATABASE_URL, logger });
  await db.assertSafeConnection();
  // Web only sends (ADR-005).
  const jobs = createJobs({ connectionString: env.DATABASE_URL, role: 'web', logger });
  await jobs.start();
  logger.info('Web started', { event: 'web.started' });
  return { env, logger, db, jobs };
}

// One per server process, started by instrumentation.ts.
export function getRuntime(): Promise<Runtime> {
  holder.comprobifyRuntime ??= start();
  return holder.comprobifyRuntime;
}
