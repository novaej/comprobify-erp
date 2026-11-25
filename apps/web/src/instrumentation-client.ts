import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './lib/sentry';

// Browser Sentry (ADR-008). The DSN comes from the server, since the image is built once for
// every environment; without one, nothing starts. Errors before it answers are not reported.
void fetch('/api/client-config')
  .then((res) => (res.ok ? res.json() : {}))
  .then((config: { sentryDsn?: string; environment?: string }) => {
    if (config.sentryDsn)
      Sentry.init(sentryOptions(config.sentryDsn, config.environment ?? 'unknown'));
  })
  .catch(() => {});
