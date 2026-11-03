import { loadTestEnv } from '@comprobify/config/env';
import { createLogger } from '@comprobify/config/logger';
import { installJobs, publishAgreements } from '@comprobify/core';
import { createDatabase } from '@comprobify/db';
import { runMigrations } from '@comprobify/db/migrator';

export default async function setup(): Promise<void> {
  const url = loadTestEnv().TEST_MIGRATION_DATABASE_URL;
  await runMigrations(url);
  await installJobs(url);
  const owner = createDatabase({
    connectionString: url,
    logger: createLogger({ service: 'test', level: 'warn' }),
  });
  await publishAgreements(owner);
  await owner.close();
}
