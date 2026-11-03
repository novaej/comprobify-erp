import { loadMigrateEnv } from '@comprobify/config/env';
import { createLogger } from '@comprobify/config/logger';
import { installJobs, publishAgreements } from '@comprobify/core';
import { createDatabase } from '@comprobify/db';
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

// FR-ONB-8: a legal text edited in the repo becomes its next version.
const owner = createDatabase({ connectionString: env.MIGRATION_DATABASE_URL, logger });
try {
  const published = await publishAgreements(owner);
  if (published.length > 0)
    logger.info(`Published legal texts: ${published.join(', ')}`, {
      event: 'agreements.published',
    });
} finally {
  await owner.close();
}
logger.info('Migrations applied', { event: 'db.migrated' });
