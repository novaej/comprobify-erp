import { existsSync } from 'node:fs';
import { loadE2eEnv } from '@comprobify/config/env';
import { defineConfig, devices } from '@playwright/test';

// The auth tests read queued emails from the database. CI sets real variables.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

// Runs leave their accounts and companies behind, so they use their own database, never
// the one `pnpm dev` uses. The defaults match .env.example and the Docker stack.
const e2e = loadE2eEnv({
  E2E_DATABASE_URL:
    process.env.E2E_DATABASE_URL ??
    'postgres://comprobify_erp_app:changeme@localhost:5432/comprobify_erp_e2e',
  E2E_MIGRATION_DATABASE_URL:
    process.env.E2E_MIGRATION_DATABASE_URL ??
    'postgres://comprobify_erp_owner:changeme@localhost:5432/comprobify_erp_e2e',
});
// The app Playwright starts, its migrate step and the tests all read these.
process.env.DATABASE_URL = e2e.E2E_DATABASE_URL;
process.env.MIGRATION_DATABASE_URL = e2e.E2E_MIGRATION_DATABASE_URL;

// E2E_BASE_URL points at a running app, such as the Docker stack on :8080.
// Without it, Playwright starts the built web app itself.
// E2E_PORT moves the app it starts, so a `pnpm dev` left running on :3000 is never the one tested.
const port = process.env.E2E_PORT ?? '3000';
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

const AGREEMENTS_ON = {
  AGREEMENTS_ENABLED: 'true',
  OPERATOR_NAME: 'Operadora de Pruebas',
  OPERATOR_RUC: '1712345678001',
  OPERATOR_ADDRESS: 'Quito',
  SUPPORT_EMAIL: 'soporte@example.com',
};
// Tests read this to know which flow to expect: on when Playwright starts the app,
// or as the running app at E2E_BASE_URL is configured.
process.env.E2E_AGREEMENTS ??= process.env.E2E_BASE_URL
  ? (process.env.AGREEMENTS_ENABLED ?? 'false')
  : 'true';

export default defineConfig({
  testDir: '.',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // Migrate first: Playwright starts this before any global setup would run.
        command: `pnpm --silent --filter @comprobify/worker db:migrate && pnpm --filter @comprobify/web start -p ${port}`,
        url: `${baseURL}/health`,
        // Never reuse: whatever already answers may be a dev server on another database, and the
        // tests would register accounts in it.
        reuseExistingServer: false,
        timeout: 60_000,
        // The server Playwright starts has the legal texts on, so CI covers acceptance. It
        // never calls SRI or Payphone, whatever .env says (ADR-014, ADR-033).
        env: {
          ...(process.env as Record<string, string>),
          ...AGREEMENTS_ON,
          SRI_MOCK_MODE: 'true',
          // Never Payphone, whatever .env says: the flows here pay by transfer (ADR-033).
          // Blank counts as unset, and a set variable wins over the app's own .env.
          PAYPHONE_TOKEN: '',
          PAYPHONE_STORE_ID: '',
        },
      },
});
