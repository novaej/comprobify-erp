import type { Logger } from '@comprobify/config/logger';
import type { Tx } from '@comprobify/db';
import { PgBoss, type ConstructorOptions } from 'pg-boss';
import { queues, schedules, type QueueName, type QueuePayload } from './registry';

const SCHEMA = 'pgboss';

export type JobHandler<Name extends QueueName> = (job: {
  id: string;
  data: QueuePayload<Name>;
}) => Promise<void>;

export type Jobs = {
  boss: PgBoss;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  enqueue: <Name extends QueueName>(
    tx: Tx,
    queue: Name,
    data: QueuePayload<Name>,
  ) => Promise<string | null>;
  // Only where a library owns the write, so no transaction of ours exists: Better
  // Auth's verification and reset emails (ADR-009). The user can ask again.
  enqueueWithoutTransaction: <Name extends QueueName>(
    queue: Name,
    data: QueuePayload<Name>,
  ) => Promise<string | null>;
  work: <Name extends QueueName>(queue: Name, handler: JobHandler<Name>) => Promise<void>;
  applySchedules: () => Promise<void>;
};

export type JobsOptions = {
  connectionString: string;
  // Web only sends; the worker owns handlers, cron and maintenance (ADR-005).
  role: 'web' | 'worker';
  logger: Logger;
  // Sentry, injected so core stays vendor-free.
  reportError?: (err: unknown) => void;
};

function bossOptions({ connectionString, role }: JobsOptions): ConstructorOptions {
  const worker = role === 'worker';
  return {
    connectionString,
    schema: SCHEMA,
    // The app role has no DDL rights (NFR-SEC-4), and REINDEX needs table ownership.
    migrate: false,
    createSchema: false,
    reindex: false,
    schedule: worker,
    supervise: worker,
  };
}

export function createJobs(options: JobsOptions): Jobs {
  const { logger, reportError } = options;
  const boss = new PgBoss(bossOptions(options));
  boss.on('error', (err) => {
    logger.error('Job queue error', { event: 'jobs.error', err });
    reportError?.(err);
  });

  return {
    boss,
    start: async () => {
      await boss.start();
    },
    stop: () => boss.stop(),

    // The tx is the point: no commit, no job.
    enqueue: (tx, queue, data) => boss.send(queue, queues[queue].payload.parse(data), { db: tx }),
    enqueueWithoutTransaction: (queue, data) => boss.send(queue, queues[queue].payload.parse(data)),

    work: async <Name extends QueueName>(queue: Name, handler: JobHandler<Name>) => {
      const { payload, concurrency } = queues[queue];
      await boss.work(queue, { localConcurrency: concurrency }, async (jobs) => {
        for (const job of jobs) {
          try {
            await handler({ id: job.id, data: payload.parse(job.data) as QueuePayload<Name> });
          } catch (err) {
            // pg-boss only stores this on the job; rethrown so it retries or fails.
            logger.error('Job failed', { event: 'jobs.failed', jobId: job.id, err });
            reportError?.(err);
            throw err;
          }
        }
      });
    },

    applySchedules: async () => {
      const declared = new Set<string>(schedules.map((schedule) => schedule.queue));
      for (const existing of await boss.getSchedules()) {
        if (!declared.has(existing.name)) await boss.unschedule(existing.name, existing.key);
      }
      for (const { queue, cron, tz, data } of schedules)
        await boss.schedule(queue, cron, data, { tz });
    },
  };
}

// Migrate step only, as the owner role. Schema upgrades and queues live here.
export async function installJobs(connectionString: string): Promise<void> {
  const boss = new PgBoss({
    connectionString,
    schema: SCHEMA,
    migrate: true,
    createSchema: false,
    schedule: false,
    supervise: false,
  });
  await boss.start();
  try {
    for (const [name, { options }] of Object.entries(queues)) {
      await boss.createQueue(name, options);
      await boss.updateQueue(name, options);
    }
  } finally {
    await boss.stop();
  }
}
