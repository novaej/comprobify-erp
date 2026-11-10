import type { Logger } from '@comprobify/config/logger';
import type { Database } from '@comprobify/db';
import type { Jobs } from '../jobs';
import type { Clock } from '../kernel';
import { FINAL_DOCUMENT_STATUSES } from './status';

// FR-BULK-4, NFR-PERF-3 (ADR-026): fair queuing. Items are not all queued at once: the feeder
// puts a few at a time on the queue, taking turns between companies, so the invoices a batch
// makes never outnumber what SRI is answering and a company's single invoice waits behind a
// few documents, not thousands. The caps are tuned at the production-readiness load test.
export type BulkLimits = {
  // Items one company may have in flight: being made, or made and not yet answered by SRI.
  perCompany: number;
  // The same over all companies.
  global: number;
  // A dispatched item untouched this long lost its job (a crash, a purge): it is queued again.
  stallMinutes: number;
  // How soon the feeder looks again while items wait.
  feedDelaySeconds: number;
};

export const BULK_LIMITS: BulkLimits = {
  perCompany: 10,
  global: 30,
  stallMinutes: 15,
  feedDelaySeconds: 5,
};

export type FeedDeps = {
  db: Database;
  jobs: Pick<Jobs, 'enqueue'>;
  clock: Clock;
  logger: Logger;
};

type Share = { tenantId: string; inflight: number; waiting: number };

// How many items each company gets this round: one at a time in turn, those with the least in
// flight first, until the global room or a company's own room or its waiting items run out.
export function allocateSlots(shares: Share[], limits: BulkLimits): Map<string, number> {
  const given = new Map(shares.map((share) => [share.tenantId, 0]));
  let free = limits.global - shares.reduce((sum, share) => sum + share.inflight, 0);
  const turns = [...shares].sort(
    (a, b) => a.inflight - b.inflight || a.tenantId.localeCompare(b.tenantId),
  );
  const room = (share: Share) =>
    Math.min(share.waiting, limits.perCompany - share.inflight) - given.get(share.tenantId)!;
  let moved = true;
  while (free > 0 && moved) {
    moved = false;
    for (const share of turns) {
      if (free > 0 && room(share) > 0) {
        given.set(share.tenantId, given.get(share.tenantId)! + 1);
        free--;
        moved = true;
      }
    }
  }
  return given;
}

// Our own constants, never input.
const FINAL = FINAL_DOCUMENT_STATUSES.map((status) => `'${status}'`).join(', ');

export async function feedBatches(
  deps: FeedDeps,
  limits: BulkLimits = BULK_LIMITS,
  // Only these companies, for tests that share a database with others' batches.
  onlyTenants: string[] | null = null,
): Promise<{ dispatched: number; waiting: number }> {
  const { db, jobs, clock, logger } = deps;
  const now = clock.now();
  const stalled = new Date(now.getTime() - limits.stallMinutes * 60_000);
  const scope = onlyTenants ? 'AND i.tenant_id = ANY($1::uuid[])' : 'AND $1::uuid[] IS NULL';
  const scopeArg = [onlyTenants];

  const result = await db.withSystem(
    'feed the waiting items of bulk batches to the worker, company by company',
    async (tx) => {
      // One feeder at a time, whichever worker runs it.
      await tx.executeSql(`SELECT pg_advisory_xact_lock(hashtext('bulk.feed'))`);
      const queue = async (rows: { id: string; tenantId: string }[]) => {
        if (rows.length === 0) return;
        await tx.executeSql(`UPDATE bulk_batch_items SET dispatched_at = $1 WHERE id = ANY($2)`, [
          now,
          rows.map((row) => row.id),
        ]);
        for (const row of rows)
          await jobs.enqueue(tx, 'bulk.item', { tenantId: row.tenantId, itemId: row.id });
      };

      // Items whose job went missing go back on the queue; they already count as in flight.
      const lost = await tx.executeSql<{ id: string; tenantId: string }>(
        `SELECT i.id, i.tenant_id AS "tenantId" FROM bulk_batch_items i
         JOIN bulk_batches b ON b.tenant_id = i.tenant_id AND b.id = i.batch_id
         WHERE b.status = 'PROCESSING' AND i.status IN ('QUEUED', 'CREATING')
           AND i.dispatched_at < $2 ${scope}
         FOR UPDATE OF i SKIP LOCKED`,
        [...scopeArg, stalled],
      );
      await queue(lost.rows);

      const inflight = await tx.executeSql<{ tenantId: string; n: number }>(
        `SELECT i.tenant_id AS "tenantId", count(*)::int AS n FROM bulk_batch_items i
         JOIN bulk_batches b ON b.tenant_id = i.tenant_id AND b.id = i.batch_id
         LEFT JOIN documents d ON d.tenant_id = i.tenant_id AND d.id = i.document_id
         WHERE b.status = 'PROCESSING' ${scope} AND (
           (i.status IN ('QUEUED', 'CREATING') AND i.dispatched_at IS NOT NULL)
           OR (i.status = 'CREATED' AND d.status NOT IN (${FINAL})))
         GROUP BY 1`,
        scopeArg,
      );
      const waiting = await tx.executeSql<{ tenantId: string; n: number }>(
        `SELECT i.tenant_id AS "tenantId", count(*)::int AS n FROM bulk_batch_items i
         JOIN bulk_batches b ON b.tenant_id = i.tenant_id AND b.id = i.batch_id
         WHERE b.status = 'PROCESSING' AND i.status = 'QUEUED' AND i.dispatched_at IS NULL ${scope}
         GROUP BY 1`,
        scopeArg,
      );
      const flying = new Map(inflight.rows.map((row) => [row.tenantId, row.n]));
      const shares = waiting.rows.map((row) => ({
        tenantId: row.tenantId,
        waiting: row.n,
        inflight: flying.get(row.tenantId) ?? 0,
      }));
      // Other companies' work in flight takes the global room even when they wait for nothing.
      const others = [...flying]
        .filter(([tenantId]) => !shares.some((share) => share.tenantId === tenantId))
        .map(([tenantId, n]) => ({ tenantId, inflight: n, waiting: 0 }));
      const turns = allocateSlots([...shares, ...others], limits);

      let dispatched = 0;
      for (const [tenantId, count] of turns) {
        if (count === 0) continue;
        const picked = await tx.executeSql<{ id: string; tenantId: string }>(
          `SELECT i.id, i.tenant_id AS "tenantId" FROM bulk_batch_items i
           JOIN bulk_batches b ON b.tenant_id = i.tenant_id AND b.id = i.batch_id
           WHERE i.tenant_id = $1 AND b.status = 'PROCESSING' AND i.status = 'QUEUED'
             AND i.dispatched_at IS NULL
           ORDER BY b.created_at, b.id, i.position LIMIT $2
           FOR UPDATE OF i SKIP LOCKED`,
          [tenantId, count],
        );
        await queue(picked.rows);
        dispatched += picked.rows.length;
      }
      const left = shares.reduce((sum, share) => sum + share.waiting, 0) - dispatched;
      // Still waiting: look again soon, as slots free up when SRI answers.
      if (left > 0)
        await jobs.enqueue(
          tx,
          'bulk.feed',
          {},
          { startAfter: new Date(now.getTime() + limits.feedDelaySeconds * 1000) },
        );
      return { dispatched, waiting: left, lost: lost.rows.length };
    },
  );
  if (result.lost > 0)
    logger.warn(`Queued again ${result.lost} batch items that lost their job`, {
      event: 'bulk.items_requeued',
    });
  return { dispatched: result.dispatched, waiting: result.waiting };
}
