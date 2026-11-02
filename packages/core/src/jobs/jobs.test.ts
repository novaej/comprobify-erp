import type { Logger } from '@comprobify/config/logger';
import { describe, expect, it, vi } from 'vitest';
import { heartbeatHandler } from './handlers/heartbeat';
import { queues, schedules } from './registry';

describe('job registry', () => {
  it('schedules only declared queues, each with an explicit time zone (NFR-JOB-2)', () => {
    expect(schedules.length).toBeGreaterThan(0);
    for (const schedule of schedules) {
      expect(queues).toHaveProperty([schedule.queue]);
      expect(schedule.tz).toBe('America/Guayaquil');
      // pg-boss stores this on every job the schedule sends.
      expect(queues[schedule.queue].payload.safeParse(schedule.data).success).toBe(true);
    }
  });

  it('rejects an unexpected payload shape', () => {
    expect(queues['system.heartbeat'].payload.safeParse('nope').success).toBe(false);
  });
});

describe('heartbeat', () => {
  it('logs the job id and is safe to repeat (NFR-JOB-1)', async () => {
    const info = vi.fn();
    const handler = heartbeatHandler({ info } as unknown as Logger);
    await handler({ id: 'a' });
    await handler({ id: 'a' });
    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledWith('Heartbeat', { event: 'jobs.heartbeat', jobId: 'a' });
  });
});
