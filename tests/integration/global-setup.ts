import { loadTestEnv } from '@comprobify/config/env';
import { runMigrations } from '@comprobify/db/migrator';

export default async function setup(): Promise<void> {
  await runMigrations(loadTestEnv().TEST_MIGRATION_DATABASE_URL);
}
