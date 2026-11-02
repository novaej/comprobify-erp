import { existsSync } from 'node:fs';
import { loadTestEnv } from '@comprobify/config/env';
import { defineConfig } from 'vitest/config';

// CI sets real variables, and loadEnvFile never overrides them.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

// Here, not in globalSetup, where vitest's crash reporting hides the message.
loadTestEnv();

export default defineConfig({
  test: {
    globalSetup: './global-setup.ts',
    // Probe tables are visible to the catalog check in other files.
    fileParallelism: false,
  },
});
