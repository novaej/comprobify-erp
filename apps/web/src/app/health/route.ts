import { getRuntime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Deploys wait for this (PRD 9.4). No details in the body.
export async function GET(): Promise<Response> {
  try {
    const { db, jobs } = await getRuntime();
    await db.ping();
    if (!(await jobs.boss.getQueue('system.heartbeat'))) throw new Error('Job queue missing');
    return Response.json({ status: 'ok' }, { headers: NO_STORE });
  } catch (err) {
    const runtime = await getRuntime().catch(() => undefined);
    runtime?.logger.error('Health check failed', { event: 'web.health_failed', err });
    return Response.json({ status: 'unavailable' }, { status: 503, headers: NO_STORE });
  }
}
