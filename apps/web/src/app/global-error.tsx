'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import messages from '../../messages/es.json';

// Replaces the root layout, so there is no i18n provider: Spanish, the default.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <h2 className="text-xl font-semibold">{messages.errorBoundary.title}</h2>
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          {messages.common.retry}
        </button>
      </body>
    </html>
  );
}
