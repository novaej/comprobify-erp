import { execFileSync } from 'node:child_process';

// The E2E database is migrated before every run, as the integration tests do theirs.
// The config has pointed MIGRATION_DATABASE_URL at it; an existing variable wins over .env.
export default function setup(): void {
  execFileSync('pnpm', ['--filter', '@comprobify/worker', 'db:migrate'], {
    cwd: '../..',
    env: { ...process.env, LOG_LEVEL: 'warn' },
    stdio: 'inherit',
  });
}
