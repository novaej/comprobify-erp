import { loadEntitlements } from '../entitlements';
import { limitOf } from '../kernel';
import { notify, type WatchDeps } from '../notifications';
import { activeCompanyIds } from '../tenancy';
import { quotaFor } from './compose';

// FR-NOT-2: the share of the period's documents at which a company is first warned.
export const QUOTA_WARNING_PERCENT = 80;

// Every few minutes: tells a company that has used 80 % of its document quota, and again when it
// has used it all. A key per quota window and step tells each once (NFR-JOB-1), and a new window
// starts again. Only the closest step is told. A company still in test has made no documents in
// its real tenant, so it never reads as near.
export async function watchQuota(deps: WatchDeps): Promise<number> {
  const now = deps.clock.now();
  const companies = await deps.db.withSystem('list companies for the quota warnings', (tx) =>
    activeCompanyIds(tx),
  );
  let told = 0;
  for (const tenantId of companies) {
    told += await deps.db.withSystem('warn a company about its document quota', async (tx) => {
      const entitlements = await loadEntitlements(tx.db, tenantId, now);
      const monthly = limitOf(entitlements, 'DOCUMENT_QUOTA');
      if (monthly === null) return 0;
      const { used, limit, window } = await quotaFor(tx, tenantId, monthly, now);
      if (limit === null || limit <= 0) return 0;
      const reached = used >= limit;
      if (!reached && used * 100 < limit * QUOTA_WARNING_PERCENT) return 0;
      return notify(tx, deps.notice, {
        tenantId,
        type: reached ? 'QUOTA_REACHED' : 'QUOTA_NEARING',
        params: { count: String(limit) },
        dedupeKey: `quota:${window.start}:${reached ? 100 : QUOTA_WARNING_PERCENT}`,
      });
    });
  }
  if (told > 0)
    deps.logger.info(`Told ${told} members about their document quota`, {
      event: 'notifications.quota_watched',
    });
  return told;
}
