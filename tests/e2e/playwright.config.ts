import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The auth tests read queued emails from the database. CI sets real variables.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

// E2E_BASE_URL points at a running app, such as the Docker stack on :8080.
// Without it, Playwright starts the built web app itself.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

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
      },
});
