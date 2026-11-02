import type { QueueOptions } from 'pg-boss';
import { z } from 'zod';

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
}[] = [{ queue: 'system.heartbeat', cron: '*/5 * * * *', tz: JOB_TIME_ZONE, data: {} }];
