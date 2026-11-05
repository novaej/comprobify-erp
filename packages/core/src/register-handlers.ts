import type { Logger } from '@comprobify/config/logger';
import type { Database, IdentityDb } from '@comprobify/db';
import {
  alertOverdueAuthorizations,
  checkAfterDeadline,
  checkAuthorization,
  enqueueReissues,
  reissueDocument,
  sendDocument,
} from './documents';
import { sendEmailHandler, type EmailProvider } from './email';
import { createRateLimiter, pruneIdentityTables } from './identity';
import { heartbeatHandler, type Jobs } from './jobs';
import type { KeyCipher } from './certificates';
import type { Clock } from './kernel';
import type { SriClient } from './sri';

export type HandlerDeps = {
  logger: Logger;
  emailProvider: EmailProvider;
  identityDb: IdentityDb;
  db: Database;
  sri: SriClient;
  keyCipher: KeyCipher;
  clock: Clock;
};

// Every job handler the worker runs.
export async function registerHandlers(jobs: Jobs, deps: HandlerDeps): Promise<void> {
  const { logger, emailProvider, identityDb, clock } = deps;
  const sending = { db: deps.db, sri: deps.sri, jobs, clock, logger };
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
  await jobs.work('sri.send', (job) => sendDocument(sending, job.data));
  await jobs.work('sri.authorize', (job) => checkAuthorization(sending, job.data));
  await jobs.work('sri.deadline', (job) => checkAfterDeadline(sending, job.data));
  await jobs.work('sri.reissue-sweep', async () => {
    await enqueueReissues(sending);
  });
  await jobs.work('sri.reissue', (job) =>
    reissueDocument({ ...sending, keyCipher: deps.keyCipher }, job.data),
  );
  await jobs.work('sri.overdue', async () => {
    await alertOverdueAuthorizations(sending);
  });
}
