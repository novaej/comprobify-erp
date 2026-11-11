import type { Logger } from '@comprobify/config/logger';
import type { Database, IdentityDb } from '@comprobify/db';
import { reconcileCardPayments, runBillingDay, type PayphoneGateway } from './billing';
import {
  alertOverdueAuthorizations,
  checkAfterDeadline,
  checkAuthorization,
  emailDocument,
  enqueueReissues,
  reissueDocument,
  sendDocument,
  watchQuota,
} from './documents';
import { completeBatches, feedBatches, processItem } from './bulk';
import { loadCopy, sendEmailHandler, type EmailProvider } from './email';
import { createRateLimiter, pruneIdentityTables } from './identity';
import { verifyStockLevels } from './inventory';
import { heartbeatHandler, type Jobs } from './jobs';
import { deliverNotificationEvent, watchCertificates } from './notifications';
import { sendPurchaseOrderEmail } from './purchasing';
import type { KeyCipher } from './certificates';
import type { IssueDeps } from './documents';
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
  // What issuing a document needs, for the invoices a batch makes (ADR-026).
  issue: Omit<IssueDeps, 'jobs' | 'keyCipher'>;
  // Where the daily billing job's emails point (ADR-032).
  billing: { appUrl: string };
  // Null when Payphone isn't set up: the sweep has nothing to ask (ADR-033).
  payphone: PayphoneGateway | null;
};

// Every job handler the worker runs.
export async function registerHandlers(jobs: Jobs, deps: HandlerDeps): Promise<void> {
  const { logger, emailProvider, identityDb, clock } = deps;
  const sending = { db: deps.db, sri: deps.sri, jobs, clock, logger };
  await jobs.work('system.heartbeat', heartbeatHandler(logger));
  await jobs.work(
    'email.send',
    sendEmailHandler(emailProvider, (template, locale) => loadCopy(deps.db, template, locale)),
  );
  await jobs.work('notifications.send', (job) =>
    deliverNotificationEvent(
      { db: deps.db, notice: { jobs, appUrl: deps.billing.appUrl } },
      job.data,
    ),
  );
  const watch = {
    db: deps.db,
    notice: { jobs, appUrl: deps.billing.appUrl },
    clock,
    logger,
  };
  await jobs.work('certificates.watch', async () => {
    await watchCertificates(watch);
  });
  await jobs.work('quota.watch', async () => {
    await watchQuota(watch);
  });
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
  await jobs.work('documents.email', (job) =>
    emailDocument({ db: deps.db, provider: emailProvider, clock, logger }, job.data),
  );
  await jobs.work('purchasing.email', (job) =>
    sendPurchaseOrderEmail({ db: deps.db, provider: emailProvider, clock, logger }, job.data),
  );
  await jobs.work('inventory.verify', async () => {
    await verifyStockLevels({ db: deps.db, logger });
  });
  await jobs.work('bulk.item', (job) =>
    processItem(
      {
        db: deps.db,
        jobs,
        clock,
        logger,
        issue: { ...deps.issue, keyCipher: deps.keyCipher },
      },
      job.data,
    ),
  );
  await jobs.work('bulk.feed', async () => {
    await feedBatches({ db: deps.db, jobs, clock, logger });
  });
  await jobs.work('bulk.complete', async () => {
    await completeBatches({ db: deps.db, jobs, clock, logger });
  });
  await jobs.work('billing.daily', async () => {
    await runBillingDay({ db: deps.db, jobs, clock, logger, ...deps.billing });
  });
  const payphone = deps.payphone;
  await jobs.work('payphone.reconcile', async () => {
    if (payphone)
      await reconcileCardPayments({
        db: deps.db,
        gateway: payphone,
        clock,
        logger,
        notice: { jobs, appUrl: deps.billing.appUrl },
      });
  });
  await jobs.work('sri.overdue', async () => {
    await alertOverdueAuthorizations(sending);
  });
}
