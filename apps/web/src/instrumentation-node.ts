import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './lib/sentry';
import { getRuntime } from './server/runtime';

// Node runtime only: loaded from instrumentation.ts.
export async function startNode(): Promise<void> {
  try {
    const { env } = await getRuntime();
    if (env.SENTRY_DSN) {
      Sentry.init(sentryOptions(env.SENTRY_DSN, env.APP_ENV));
    }
  } catch (error) {
    // Bad env, unsafe role or no database: refuse to serve (NFR-SEC-4).
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
