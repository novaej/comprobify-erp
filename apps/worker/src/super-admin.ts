// Operator only: give or take the super admin flag (ADR-010). The app never sets it.
// Usage: pnpm super-admin <email> [--revoke]
import { loadMigrateEnv } from '@comprobify/config/env';
import { createLogger } from '@comprobify/config/logger';
import { setSuperAdmin } from '@comprobify/core';
import { createDatabase } from '@comprobify/db';

const [email, flag] = process.argv.slice(2);
if (!email || (flag && flag !== '--revoke')) {
  console.error('Usage: pnpm super-admin <email> [--revoke]');
  process.exit(1);
}

const env = loadMigrateEnv();
const logger = createLogger({ service: 'super-admin', level: 'warn' });
const db = createDatabase({ connectionString: env.MIGRATION_DATABASE_URL, logger });
try {
  const grant = flag !== '--revoke';
  if (!(await setSuperAdmin(db.identity, email, grant))) {
    console.error(`No account with the email ${email}`);
    process.exitCode = 1;
  } else console.log(`${email} ${grant ? 'is now' : 'is no longer'} a super admin.`);
} finally {
  await db.close();
}
