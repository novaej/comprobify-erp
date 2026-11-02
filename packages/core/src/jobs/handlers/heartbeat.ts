import type { Logger } from '@comprobify/config/logger';

// Writes nothing, so running twice is harmless (NFR-JOB-1).
export function heartbeatHandler(logger: Logger) {
  return (job: { id: string }): Promise<void> => {
    logger.info('Heartbeat', { event: 'jobs.heartbeat', jobId: job.id });
    return Promise.resolve();
  };
}
