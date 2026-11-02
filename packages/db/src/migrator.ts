import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

// Owner role only. A held lock fails fast instead of queueing traffic (lesson 12).
export async function runMigrations(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`SET lock_timeout = '5s'`);
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.end();
  }
}
