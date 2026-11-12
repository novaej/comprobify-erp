// Local and staging only: run a scheduled job now instead of waiting for its time, for testing by
// hand (the QA script). The worker must be running to pick it up. Usage: pnpm run-job <queue>
import { loadWorkerEnv } from '@comprobify/config/env';
import { createLogger } from '@comprobify/config/logger';
import { createJobs, schedules } from '@comprobify/core';

const queue = process.argv[2];
const scheduled = schedules.map((schedule) => schedule.queue);
const usage = `Usage: pnpm run-job <queue>\nScheduled queues: ${scheduled.join(', ')}`;
// Asking what can be run is not a failure.
if (!queue) {
  console.log(usage);
  process.exit(0);
}
if (!(scheduled as string[]).includes(queue)) {
  console.error(`Unknown queue "${queue}".\n${usage}`);
  process.exit(1);
}

const env = loadWorkerEnv();
if (env.APP_ENV === 'production') {
  console.error('Not in production: jobs run on their schedule there.');
  process.exit(1);
}
const logger = createLogger({ service: 'run-job', level: 'warn' });
const jobs = createJobs({ connectionString: env.DATABASE_URL, role: 'web', logger });
await jobs.start();
try {
  const id = await jobs.enqueueWithoutTransaction(
    queue as (typeof scheduled)[number],
    schedules.find((schedule) => schedule.queue === queue)!.data,
  );
  console.log(
    id ? `Queued ${queue} (${id}); the worker runs it next.` : `${queue} is already queued.`,
  );
} finally {
  await jobs.stop();
}
