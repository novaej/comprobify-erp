import type { Logger } from '@comprobify/config/logger';
import type { Database } from '@comprobify/db';
import { ecuadorDate, type Clock } from '../kernel';
import { activeCertificateExpiries } from '../tenancy';
import { notify, type NotifyDeps } from './notify';

// FR-NOT-2: the days ahead the certificate's owners are told, the closest one that has passed.
export const CERTIFICATE_REMINDER_DAYS = [7, 15, 30] as const;

export type WatchDeps = { db: Database; notice: NotifyDeps; clock: Clock; logger: Logger };

// Once a day: tells each real company whose certificate ends within 30, 15 or 7 days, and once
// when it has ended. A key per certificate and step makes a second run, or a run after missed
// days, tell no one twice (NFR-JOB-1); only the closest step is told, so a long outage doesn't
// send three notices at once.
export async function watchCertificates(deps: WatchDeps): Promise<number> {
  const now = deps.clock.now();
  const certificates = await deps.db.withSystem(
    'list certificates for the expiry reminders',
    (tx) => activeCertificateExpiries(tx),
  );
  let told = 0;
  for (const { tenantId, certificateId, notAfter } of certificates) {
    const daysLeft = Math.floor((notAfter.getTime() - now.getTime()) / 86_400_000);
    const step = CERTIFICATE_REMINDER_DAYS.find((days) => daysLeft <= days);
    if (step === undefined) continue;
    const date = ecuadorDate(notAfter);
    const expired = daysLeft < 0;
    told += await deps.db.withSystem('tell a company about its certificate expiry', (tx) =>
      notify(tx, deps.notice, {
        tenantId,
        type: expired ? 'CERTIFICATE_EXPIRED' : 'CERTIFICATE_EXPIRING',
        params: expired ? { date } : { date, count: String(daysLeft) },
        dedupeKey: `certificate:${certificateId}:${expired ? 'expired' : step}`,
      }),
    );
  }
  if (told > 0)
    deps.logger.info(`Told ${told} members about certificates`, {
      event: 'notifications.certificates_watched',
    });
  return told;
}
