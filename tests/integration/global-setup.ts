import { loadTestEnv } from '@comprobify/config/env';
import { installJobs } from '@comprobify/core';
import { runMigrations } from '@comprobify/db/migrator';

export default async function setup(): Promise<void> {
  const url = loadTestEnv().TEST_MIGRATION_DATABASE_URL;
  await runMigrations(url);
  await installJobs(url);
}
