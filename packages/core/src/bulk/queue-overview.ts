import type { Database } from '@comprobify/db';
import { assertSuperAdmin } from '../identity';
import type { PlatformActor } from '../kernel';
import { BULK_LIMITS } from './feed';
import { FINAL_DOCUMENT_STATUSES } from './status';

// ADR-026: what the feeder is working through, for the platform area. Read-only, across
// companies, in system context with a reason; it shows whether the caps are doing their job.
export type QueueCompany = {
  tenantId: string;
  name: string;
  // The company's test twin, whose work counts separately.
  isTwin: boolean;
  batches: number;
  waiting: number;
  inFlight: number;
  failed: number;
  oldestWaiting: Date | null;
};

export type QueueOverview = {
  limits: { perCompany: number; global: number };
  inFlight: number;
  waiting: number;
  companies: QueueCompany[];
};

// Our own constants, never input.
const FINAL = FINAL_DOCUMENT_STATUSES.map((status) => `'${status}'`).join(', ');

export async function bulkQueueOverview(
  actor: PlatformActor,
  db: Database,
): Promise<QueueOverview> {
  await assertSuperAdmin(db.identity, actor);
  const companies = await db.withSystem(
    'super admin: read the bulk invoicing queue across companies',
    async ({ executeSql }) => {
      const { rows } = await executeSql<QueueCompany>(
        `SELECT i.tenant_id AS "tenantId", coalesce(t.trade_name, t.legal_name) AS name,
                (t.twin_of IS NOT NULL) AS "isTwin", count(DISTINCT b.id)::int AS batches,
                count(*) FILTER (WHERE i.status = 'QUEUED' AND i.dispatched_at IS NULL)::int AS waiting,
                count(*) FILTER (WHERE (i.status IN ('QUEUED', 'CREATING') AND i.dispatched_at IS NOT NULL)
                  OR (i.status = 'CREATED' AND d.status NOT IN (${FINAL})))::int AS "inFlight",
                count(*) FILTER (WHERE i.status = 'FAILED')::int AS failed,
                min(i.created_at) FILTER (WHERE i.status = 'QUEUED' AND i.dispatched_at IS NULL)
                  AS "oldestWaiting"
         FROM bulk_batch_items i
         JOIN bulk_batches b ON b.tenant_id = i.tenant_id AND b.id = i.batch_id
         JOIN tenants t ON t.id = i.tenant_id
         LEFT JOIN documents d ON d.tenant_id = i.tenant_id AND d.id = i.document_id
         WHERE b.status = 'PROCESSING'
         GROUP BY i.tenant_id, t.trade_name, t.legal_name, t.twin_of
         ORDER BY "oldestWaiting" NULLS LAST, name`,
      );
      return rows;
    },
  );
  return {
    limits: { perCompany: BULK_LIMITS.perCompany, global: BULK_LIMITS.global },
    inFlight: companies.reduce((sum, company) => sum + company.inFlight, 0),
    waiting: companies.reduce((sum, company) => sum + company.waiting, 0),
    companies,
  };
}
