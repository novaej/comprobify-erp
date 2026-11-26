import { getRuntime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

// The browser's Sentry settings, read at runtime so one image serves every environment (ADR-008).
// A DSN is public by design: it only lets one send events.
export async function GET(): Promise<Response> {
  const { env } = await getRuntime();
  const body = env.SENTRY_DSN ? { sentryDsn: env.SENTRY_DSN, environment: env.APP_ENV } : {};
  return Response.json(body, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
