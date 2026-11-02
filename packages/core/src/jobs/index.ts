import type { Logger } from '@comprobify/config/logger';
import { heartbeatHandler } from './handlers/heartbeat';
import type { Jobs } from './runtime';

export { JOB_TIME_ZONE, queues, schedules } from './registry';
export type { QueueName, QueuePayload } from './registry';
export { createJobs, installJobs } from './runtime';
export type { JobHandler, Jobs, JobsOptions } from './runtime';

export async function registerHandlers(jobs: Jobs, logger: Logger): Promise<void> {
  await jobs.work('system.heartbeat', heartbeatHandler(logger));
}
