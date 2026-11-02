import { loadMigrateEnv } from '@comprobify/config/env';
import { createLogger } from '@comprobify/config/logger';
import { installJobs } from '@comprobify/core';
import { runMigrations } from '@comprobify/db/migrator';

const env = loadMigrateEnv();
const logger = createLogger({
  service: 'migrate',
  level: env.LOG_LEVEL,
  pretty: env.LOG_FORMAT === 'pretty',
  betterstackSourceToken: env.BETTERSTACK_SOURCE_TOKEN,
});

await runMigrations(env.MIGRATION_DATABASE_URL);
await installJobs(env.MIGRATION_DATABASE_URL);
logger.info('Migrations applied', { event: 'db.migrated' });
