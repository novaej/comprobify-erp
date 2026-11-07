import type { QueueOptions } from 'pg-boss';
import { z } from 'zod';
import { sendEmailPayload } from '../email';

const documentRef = z.object({ tenantId: z.uuid(), documentId: z.uuid() });

type QueueDefinition = {
  payload: z.ZodType;
  options: QueueOptions;
  // Jobs one worker process runs at once (NFR-JOB-3).
  concurrency: number;
};

// ADR-005: adding a queue is one entry here plus a migrate step.
export const queues = {
  'system.heartbeat': {
    payload: z.object({}),
    options: { retryLimit: 0, expireInSeconds: 60 },
    concurrency: 1,
  },
  'email.send': {
    payload: sendEmailPayload,
    options: { retryLimit: 5, retryDelay: 60, retryBackoff: true, expireInSeconds: 120 },
    concurrency: 5,
  },
  // FR-DOC-4 and FR-DOC-5. Transport errors are retried on the calendar, by the handlers;
  // pg-boss retries only a crash, which the handlers survive by re-reading the status.
  'sri.send': {
    payload: documentRef,
    options: { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 120 },
    concurrency: 5,
  },
  'sri.authorize': {
    payload: documentRef,
    options: { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 120 },
    concurrency: 5,
  },
  'sri.deadline': {
    payload: documentRef,
    options: { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 120 },
    concurrency: 2,
  },
  // FR-DOC-6: the daily sweep, then one job per document. A transport error during the
  // re-check throws, so pg-boss retries it.
  'sri.reissue-sweep': {
    payload: z.object({}),
    options: { retryLimit: 2, retryDelay: 300, expireInSeconds: 300 },
    concurrency: 1,
  },
  'sri.reissue': {
    payload: documentRef.extend({
      reason: z.enum(['AUTO_NEXT_DAY', 'MANUAL']),
      // MANUAL: the date the person confirmed, and who.
      issueDate: z.iso.date().optional(),
      actorUserId: z.uuid().nullable().optional(),
    }),
    options: { retryLimit: 5, retryDelay: 300, retryBackoff: true, expireInSeconds: 120 },
    concurrency: 2,
  },
  // FR-DOC-11: the RIDE and XML to the buyer, on authorization or a manual resend.
  'documents.email': {
    payload: documentRef.extend({ resend: z.boolean() }),
    options: { retryLimit: 5, retryDelay: 60, retryBackoff: true, expireInSeconds: 120 },
    concurrency: 3,
  },
  'sri.overdue': {
    payload: z.object({}),
    options: { retryLimit: 1, expireInSeconds: 300 },
    concurrency: 1,
  },
  // FR-PUR-3: the order's PDF to the provider, enqueued with the change that asked for it.
  'purchasing.email': {
    payload: z.object({
      tenantId: z.uuid(),
      orderId: z.uuid(),
      to: z.array(z.email()).min(1).max(10),
    }),
    options: { retryLimit: 5, retryDelay: 60, retryBackoff: true, expireInSeconds: 120 },
    concurrency: 2,
  },
  // FR-INV-2: every level against its ledger, once a night.
  'inventory.verify': {
    payload: z.object({}),
    options: { retryLimit: 1, expireInSeconds: 900 },
    concurrency: 1,
  },
  'identity.prune': {
    payload: z.object({}),
    options: { retryLimit: 2, expireInSeconds: 300 },
    concurrency: 1,
  },
} satisfies Record<string, QueueDefinition>;

export type QueueName = keyof typeof queues;
export type QueuePayload<Name extends QueueName> = z.output<(typeof queues)[Name]['payload']>;

export const JOB_TIME_ZONE = 'America/Guayaquil';

// NFR-JOB-2: declared here, applied at worker start.
export const schedules: readonly {
  queue: QueueName;
  cron: string;
  tz: string;
  data: QueuePayload<QueueName>;
}[] = [
  { queue: 'system.heartbeat', cron: '*/5 * * * *', tz: JOB_TIME_ZONE, data: {} },
  { queue: 'identity.prune', cron: '15 3 * * *', tz: JOB_TIME_ZONE, data: {} },
  // Quiet hours in Quito, after the day's receipts and adjustments.
  { queue: 'inventory.verify', cron: '45 2 * * *', tz: JOB_TIME_ZONE, data: {} },
  { queue: 'sri.overdue', cron: '*/15 * * * *', tz: JOB_TIME_ZONE, data: {} },
  // After midnight in Quito, once yesterday's deadline checks have run.
  { queue: 'sri.reissue-sweep', cron: '30 0 * * *', tz: JOB_TIME_ZONE, data: {} },
];
