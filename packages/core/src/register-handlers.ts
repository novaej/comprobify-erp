import type { Logger } from '@comprobify/config/logger';
import type { IdentityDb } from '@comprobify/db';
import { sendEmailHandler, type EmailProvider } from './email';
import { createRateLimiter, pruneIdentityTables } from './identity';
import { heartbeatHandler, type Jobs } from './jobs';
import type { Clock } from './kernel';

export type HandlerDeps = {
  logger: Logger;
  emailProvider: EmailProvider;
  identityDb: IdentityDb;
  clock: Clock;
};

// Every job handler the worker runs.
export async function registerHandlers(jobs: Jobs, deps: HandlerDeps): Promise<void> {
  const { logger, emailProvider, identityDb, clock } = deps;
  await jobs.work('system.heartbeat', heartbeatHandler(logger));
  await jobs.work('email.send', sendEmailHandler(emailProvider));
  await jobs.work('identity.prune', async (job) => {
    const now = () => clock.now();
    const pruned = await pruneIdentityTables(identityDb, createRateLimiter(identityDb, now), now());
    logger.info(
      `Pruned ${pruned.sessions} sessions, ${pruned.verifications} tokens, ${pruned.rateLimitHits} rate-limit hits`,
      { event: 'identity.pruned', jobId: job.id },
    );
  });
}
