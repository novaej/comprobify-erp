import type { Logger } from '@comprobify/config/logger';

export type EmailAttachment = { filename: string; content: Buffer; contentType: string };

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  // Shown before the platform address, as in "Alfa S.A. via Comprobify" (FR-DOC-11).
  fromName?: string;
  attachments?: EmailAttachment[];
  // Mailgun custom variables, echoed by its webhooks so an event finds its document.
  variables?: Record<string, string>;
  // A document's copy goes from EMAIL_FROM_DOCUMENTS (ADR-015).
  sender?: 'documents';
  // For the notes the redirect and the staging banner add.
  locale?: 'es' | 'en';
};

// What happened, so a document's timeline never claims an email that wasn't sent.
export type SendResult = 'sent' | 'logged' | 'skipped';

export type EmailProvider = { send: (message: EmailMessage) => Promise<SendResult> };

export type MailgunOptions = {
  apiKey: string;
  domain: string;
  region: 'us' | 'eu';
  from: string;
  // The documents sender; `from` when unset.
  documentsFrom?: string;
  fetch?: typeof fetch;
};

// The address inside "Name <address>".
const addressOf = (from: string) => /<([^>]+)>/.exec(from)?.[1] ?? from;

export function createMailgunProvider(options: MailgunOptions): EmailProvider {
  const host = options.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net';
  const url = `https://${host}/v3/${encodeURIComponent(options.domain)}/messages`;
  const authorization = `Basic ${Buffer.from(`api:${options.apiKey}`).toString('base64')}`;
  const send = options.fetch ?? fetch;

  return {
    async send(message) {
      const sender =
        message.sender === 'documents' && options.documentsFrom
          ? options.documentsFrom
          : options.from;
      const fields: Record<string, string> = {
        from: message.fromName
          ? `"${message.fromName.replaceAll('"', "'")}" <${addressOf(sender)}>`
          : sender,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      };
      for (const [name, value] of Object.entries(message.variables ?? {}))
        fields[`v:${name}`] = value;
      // Attachments need multipart; plain messages stay form-encoded.
      let body: URLSearchParams | FormData = new URLSearchParams(fields);
      if (message.attachments?.length) {
        const form = new FormData();
        for (const [name, value] of Object.entries(fields)) form.append(name, value);
        for (const file of message.attachments)
          form.append(
            'attachment',
            new Blob([new Uint8Array(file.content)], { type: file.contentType }),
            file.filename,
          );
        body = form;
      }
      const response = await send(url, { method: 'POST', headers: { authorization }, body });
      // Status only: the body can echo the message, which may hold a token.
      if (!response.ok) throw new Error(`Mailgun answered ${response.status}`);
      return 'sent';
    },
  };
}

// Local only (enforced by env validation): the link is the point, so it is logged.
export function createLogProvider(logger: Logger): EmailProvider {
  return {
    send(message) {
      const files = (message.attachments ?? []).map((file) => file.filename).join(', ');
      logger.info(
        `Email to ${message.to}: ${message.subject}${files ? ` [${files}]` : ''}\n${message.text}`,
        {
          event: 'email.logged',
        },
      );
      return Promise.resolve('logged');
    },
  };
}

// EMAIL_PROVIDER=none: nothing leaves, and nothing about the recipient is logged.
export function createNoEmailProvider(): EmailProvider {
  return { send: () => Promise.resolve('skipped') };
}

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// A notice at the top of the body, text and HTML alike.
function withNotice(message: EmailMessage, notice: string, color: string): EmailMessage {
  const block = `<div style="background:${color};padding:10px 16px;margin-bottom:16px;border-radius:6px;font-weight:600">${escapeHtml(notice)}</div>`;
  return {
    ...message,
    text: `${notice}\n\n${message.text}`,
    html: /<body[^>]*>/i.test(message.html)
      ? message.html.replace(/<body[^>]*>/i, (tag) => `${tag}\n${block}`)
      : `${block}\n${message.html}`,
  };
}

// EMAIL_REDIRECT_TO: every email to one address, saying who it was for (a copy of real
// data, a demo). The env refuses it in production.
export function withRedirect(provider: EmailProvider, to: string): EmailProvider {
  return {
    send: (message) => {
      const notice =
        message.locale === 'en'
          ? `This email would have gone to: ${message.to}`
          : `Este correo habría sido enviado a: ${message.to}`;
      return provider.send({
        ...withNotice(message, notice, '#f8d7da'),
        to,
        subject: `[${message.locale === 'en' ? 'REDIRECTED' : 'REDIRIGIDO'}] ${message.subject}`,
      });
    },
  };
}

// APP_ENV=staging: nobody mistakes a staging email for a real one.
export function withTestBanner(provider: EmailProvider): EmailProvider {
  return {
    send: (message) =>
      provider.send(
        withNotice(
          message,
          message.locale === 'en'
            ? 'TEST ENVIRONMENT: this message comes from a test system and is not a real transaction.'
            : 'ENTORNO DE PRUEBAS: este mensaje viene de un sistema de pruebas y no es una transacción real.',
          '#fff3cd',
        ),
      ),
  };
}
