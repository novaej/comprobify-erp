import type { Logger } from '@comprobify/config/logger';
import { z } from 'zod';
import { copyInput, type Copy } from './copy';
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
export { loadCopy, pickCopy, syncEmailTemplates } from './store';
export { copyInput, DEFAULT_COPY, placeholderProblems, TEMPLATE_PLACEHOLDERS } from './copy';
export type { Copy } from './copy';
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
    rate: z.string().max(10).optional(),
    reason: z.string().max(60).optional(),
    number: z.string().max(30).optional(),
    count: z.string().max(10).optional(),
    name: z.string().max(300).optional(),
  }),
  // Only a test send from the template editor carries its own text: the draft, not yet published.
  copy: copyInput.optional(),
});
export type SendEmailPayload = z.output<typeof sendEmailPayload>;

// Which text an email is written from: the version in use in the database (ADR-037).
export type CopyResolver = (
  template: SendEmailPayload['template'],
  locale: SendEmailPayload['locale'],
) => Promise<Copy>;

// A retry may send twice; a duplicate link email is harmless (NFR-JOB-1). The one path every
// platform email takes, so the provider's overrides (a redirect, the staging banner) apply to all.
export function sendEmailHandler(
  provider: EmailProvider,
  resolve?: CopyResolver,
  logger?: Pick<Logger, 'info'>,
) {
  return async (job: { data: SendEmailPayload }): Promise<void> => {
    const { to, locale, template, params, copy } = job.data;
    const text = copy ?? (resolve ? await resolve(template, locale) : undefined);
    const result = await provider.send(renderEmail(template, locale, to, params, text));
    // What became of it, without the address: 'sent' means the provider took it, so a missing
    // email is then a delivery matter (spam, a sandbox's authorized recipients), not ours.
    logger?.info(`Email ${template}: ${result}`, { event: 'email.sent' });
  };
}
