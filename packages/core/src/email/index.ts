import { z } from 'zod';
import type { EmailProvider } from './provider';
import { emailLocale, emailTemplate, renderEmail } from './templates';

export {
  createLogProvider,
  createMailgunProvider,
  createNoEmailProvider,
  withRedirect,
  withTestBanner,
} from './provider';
export type {
  EmailAttachment,
  EmailMessage,
  EmailProvider,
  MailgunOptions,
  SendResult,
} from './provider';
export {
  emailLocale,
  emailTemplate,
  renderDocumentEmail,
  renderEmail,
  renderPurchaseOrderEmail,
} from './templates';
export type {
  DocumentEmailParams,
  EmailLocale,
  EmailParams,
  EmailTemplate,
  PurchaseOrderEmailParams,
} from './templates';

// The email.send job payload. The URL may hold a token; jobs are purged by pg-boss retention.
export const sendEmailPayload = z.object({
  to: z.email(),
  locale: emailLocale,
  template: emailTemplate,
  params: z.object({
    url: z.url(),
    organization: z.string().max(300).optional(),
    date: z.string().max(60).optional(),
    amount: z.string().max(30).optional(),
  }),
});
export type SendEmailPayload = z.output<typeof sendEmailPayload>;

// A retry may send twice; a duplicate link email is harmless (NFR-JOB-1).
export function sendEmailHandler(provider: EmailProvider) {
  return async (job: { data: SendEmailPayload }): Promise<void> => {
    const { to, locale, template, params } = job.data;
    await provider.send(renderEmail(template, locale, to, params));
  };
}
