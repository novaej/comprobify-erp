import type { Tx } from '@comprobify/db';
import type { EmailTemplate } from '../email';
import type { Jobs } from '../jobs';
import { Dec } from '../kernel';
import { billingContacts, companyRow } from '../tenancy';

// What a billing email needs: the queue, in the caller's transaction, and where its button goes.
export type BillingNotice = { jobs: Pick<Jobs, 'enqueue'>; appUrl: string };

const formatDate = (date: string, locale: 'es' | 'en') =>
  new Intl.DateTimeFormat(locale === 'es' ? 'es-EC' : 'en-US', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));

// FR-BILL-5 (ADR-032): a billing step, emailed to the company's owners and admins, each in their
// own language, in the transaction of the step.
export async function notifyBilling(
  tx: Tx,
  notice: BillingNotice,
  realTenantId: string,
  email: { template: EmailTemplate; date: string; amount: string | null; rate?: string },
): Promise<void> {
  const company = await companyRow(tx.db, realTenantId);
  for (const contact of await billingContacts(tx.db, realTenantId))
    await notice.jobs.enqueue(tx, 'email.send', {
      to: contact.email,
      locale: contact.locale,
      template: email.template,
      params: {
        url: `${notice.appUrl}/${contact.locale}/plan`,
        organization: company.name,
        date: formatDate(email.date, contact.locale),
        ...(email.amount ? { amount: `$${email.amount}` } : {}),
        ...(email.rate ? { rate: `${new Dec(email.rate).toString()} %` } : {}),
      },
    });
}
