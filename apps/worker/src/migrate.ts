import { loadMigrateEnv } from '@comprobify/config/env';
import { createLogger } from '@comprobify/config/logger';
import {
  assignDefaultPlans,
  installJobs,
  publishAgreements,
  syncCatalog,
  syncPrices,
} from '@comprobify/core';
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

const owner = createDatabase({ connectionString: env.MIGRATION_DATABASE_URL, logger });
try {
  // ADR-011: new feature keys, and starting modules and plans missing by key.
  const catalog = await syncCatalog(owner);
  const added = [...catalog.features, ...catalog.modules, ...catalog.plans];
  if (added.length > 0)
    logger.info(`Synced the plan catalog: ${added.join(', ')}`, { event: 'catalog.synced' });
  // ADR-027: placeholder prices for whatever has none; the super admin sets the real ones.
  const priced = await syncPrices(owner);
  if (priced.length > 0)
    logger.info(`Placeholder prices for ${priced.join(', ')}`, { event: 'prices.seeded' });
  const assigned = await assignDefaultPlans(owner);
  if (assigned > 0)
    logger.info(`Put ${assigned} tenants on the default plan`, { event: 'plans.defaulted' });
  // FR-ONB-8: a legal text edited in the repo becomes its next version.
  const published = await publishAgreements(owner);
  if (published.length > 0)
    logger.info(`Published legal texts: ${published.join(', ')}`, {
      event: 'agreements.published',
    });
} finally {
  await owner.close();
}
logger.info('Migrations applied', { event: 'db.migrated' });
