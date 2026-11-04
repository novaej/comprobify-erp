import type { QueueOptions } from 'pg-boss';
import { z } from 'zod';
import { sendEmailPayload } from '../email';

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
  // Created signed, in the same transaction (FR-DOC-2); the handler comes with the SRI client.
  'sri.send': {
    payload: z.object({ tenantId: z.uuid(), documentId: z.uuid() }),
    options: { retryLimit: 0, expireInSeconds: 120 },
    concurrency: 5,
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
];
