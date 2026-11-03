import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The auth tests read queued emails from the database. CI sets real variables.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

// E2E_BASE_URL points at a running app, such as the Docker stack on :8080.
// Without it, Playwright starts the built web app itself.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

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
        command: 'pnpm --filter @comprobify/web start',
        url: `${baseURL}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        // The server Playwright starts has the legal texts on, so CI covers acceptance.
        env: { ...(process.env as Record<string, string>), ...AGREEMENTS_ON },
      },
});
