import type { Instrumentation } from 'next';

export async function register(): Promise<void> {
  // eslint-disable-next-line no-restricted-properties -- set by Next.js, not app config
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startNode } = await import('./instrumentation-node');
    await startNode();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const Sentry = await import('@sentry/nextjs');
  const requestId = request.headers['x-request-id'];
  Sentry.withScope((scope) => {
    if (typeof requestId === 'string') scope.setTag('request_id', requestId);
    Sentry.captureRequestError(error, request, context);
  });
};
