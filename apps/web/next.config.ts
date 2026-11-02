import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Local only: the repo has one .env at its root. Real env vars, as in containers,
// always win. (next dev rejects --env-file in the NODE_OPTIONS it passes on.)
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@comprobify/config', '@comprobify/core', '@comprobify/db', '@comprobify/ui'],
  // Loaded by Node at runtime; pino transports run in worker threads (ADR-008).
  serverExternalPackages: [
    'pg',
    'pg-boss',
    'pino',
    'pino-pretty',
    '@logtail/pino',
    'thread-stream',
  ],
  // Onboarding uploads a P12 and a logo of up to 500 KB.
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
};

export default withNextIntl(nextConfig);
