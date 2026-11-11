import type { Database } from '@comprobify/db';
import { z } from 'zod';
import { recordPlatformAudit } from '../audit';
import { AUTHORIZATION_OVERDUE_AFTER, documentNumber } from '../documents';
import { assertSuperAdmin } from '../identity';
import { queues, schedules, type Jobs } from '../jobs';
import { DomainError, type PlatformActor } from '../kernel';

// FR-ADM-5: what the job queue is doing, for the platform area. Read in system context with a
// reason, across companies; a retry goes through the queue's own API, and is recorded.
export const JOB_STATES = [
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed',
] as const;
export type JobState = (typeof JOB_STATES)[number];

export type QueueStatus = {
  queue: string;
  counts: Record<JobState, number>;
  // The last job that finished well, and the last that ended failed.
  lastCompletedAt: Date | null;
  lastFailedAt: Date | null;
  // The cron it runs on, for a scheduled queue.
  schedule: string | null;
};

export async function jobsOverview(actor: PlatformActor, db: Database): Promise<QueueStatus[]> {
  await assertSuperAdmin(db.identity, actor);
  const { rows } = await db.withSystem('super admin: read the job queues', ({ executeSql }) =>
    executeSql<{ name: string; state: JobState; count: number; last: Date | null }>(
      `SELECT name, state::text AS state, count(*)::int AS count, max(completed_on) AS last
       FROM pgboss.job GROUP BY name, state`,
    ),
  );
  const cron = new Map<string, string>(schedules.map((entry) => [entry.queue, entry.cron]));
  return Object.keys(queues)
    .sort()
    .map((queue) => {
      const mine = rows.filter((row) => row.name === queue);
      const counts = Object.fromEntries(
        JOB_STATES.map((state) => [state, mine.find((row) => row.state === state)?.count ?? 0]),
      ) as Record<JobState, number>;
      return {
        queue,
        counts,
        lastCompletedAt: mine.find((row) => row.state === 'completed')?.last ?? null,
        lastFailedAt: mine.find((row) => row.state === 'failed')?.last ?? null,
        schedule: cron.get(queue) ?? null,
      };
    });
}

export type FailedJob = {
  id: string;
  queue: string;
  createdAt: Date;
  failedAt: Date | null;
  retries: number;
  // The error the job ended with. The job's own data is never shown: it can hold a link with a
  // token.
  message: string | null;
};

export async function failedJobs(
  actor: PlatformActor,
  db: Database,
  limit = 100,
): Promise<FailedJob[]> {
  await assertSuperAdmin(db.identity, actor);
  const { rows } = await db.withSystem('super admin: read the failed jobs', ({ executeSql }) =>
    executeSql<{
      id: string;
      queue: string;
      createdAt: Date;
      failedAt: Date | null;
      retries: number;
      message: string | null;
    }>(
      `SELECT id, name AS queue, created_on AS "createdAt", completed_on AS "failedAt",
              retry_count AS retries, left(output->>'message', 300) AS message
       FROM pgboss.job WHERE state = 'failed'
       ORDER BY completed_on DESC NULLS LAST LIMIT $1`,
      [Math.min(Math.max(limit, 1), 500)],
    ),
  );
  return rows;
}

export const retryJobInput = z.object({
  queue: z.enum(Object.keys(queues) as [string, ...string[]]),
  id: z.uuid(),
});

// A failed job back in its queue. Handlers are idempotent (NFR-JOB-1), so a job that half-ran
// is safe to run again.
export async function retryFailedJob(
  actor: PlatformActor,
  db: Database,
  raw: z.input<typeof retryJobInput>,
  deps: { jobs: Pick<Jobs, 'boss'> },
): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  const input = retryJobInput.parse(raw);
  const { rows } = await db.withSystem('super admin: find the job to retry', ({ executeSql }) =>
    executeSql<{ state: string }>(
      `SELECT state::text AS state FROM pgboss.job WHERE name = $1 AND id = $2`,
      [input.queue, input.id],
    ),
  );
  if (rows.length === 0) throw new DomainError('NOT_FOUND', 'Job not found');
  if (rows[0]!.state !== 'failed')
    throw new DomainError('JOB_NOT_FAILED', 'Only a failed job can be retried');
  await deps.jobs.boss.retry(input.queue, input.id);
  await db.withSystem('super admin: record a job retry', ({ db: tx }) =>
    recordPlatformAudit(tx, {
      actorUserId: actor.userId,
      action: 'job.retried',
      details: { queue: input.queue, jobId: input.id },
    }),
  );
}

export type OverdueDocument = {
  id: string;
  tenantId: string;
  company: string;
  // A test copy's documents are told apart from the real company's.
  isTwin: boolean;
  documentType: string;
  number: string;
  receivedAt: Date;
};

// Documents SRI received and has not answered for 24 hours, across companies (FR-DOC-5). Still
// RECEIVED: SRI holds them, and the company has been told.
export async function overdueDocuments(
  actor: PlatformActor,
  db: Database,
  limit = 200,
): Promise<OverdueDocument[]> {
  await assertSuperAdmin(db.identity, actor);
  const cutoff = new Date(actor.clock.now().getTime() - AUTHORIZATION_OVERDUE_AFTER);
  const { rows } = await db.withSystem(
    'super admin: read the documents overdue at SRI across companies',
    ({ executeSql }) =>
      executeSql<{
        id: string;
        tenantId: string;
        company: string;
        isTwin: boolean;
        documentType: string;
        series: string;
        sequential: number;
        receivedAt: Date;
      }>(
        `SELECT d.id, d.tenant_id AS "tenantId", coalesce(t.trade_name, t.legal_name) AS company,
                (t.twin_of IS NOT NULL) AS "isTwin", d.document_type AS "documentType",
                d.series, d.sequential, d.received_at AS "receivedAt"
         FROM documents d JOIN tenants t ON t.id = d.tenant_id
         WHERE d.status = 'RECEIVED' AND d.received_at < $1
         ORDER BY d.received_at LIMIT $2`,
        [cutoff, Math.min(Math.max(limit, 1), 500)],
      ),
  );
  return rows.map(({ series, sequential, ...row }) => ({
    ...row,
    number: documentNumber(series, sequential),
  }));
}
