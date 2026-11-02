import { loadMigrateEnv } from '@comprobify/config/env';
import { createLogger } from '@comprobify/config/logger';
import { runMigrations } from './migrator';

const env = loadMigrateEnv();
const logger = createLogger({
  service: 'migrate',
  level: env.LOG_LEVEL,
  pretty: env.APP_ENV === 'local',
  betterstackSourceToken: env.BETTERSTACK_SOURCE_TOKEN,
});

await runMigrations(env.MIGRATION_DATABASE_URL);
logger.info('Migrations applied', { event: 'db.migrated' });
