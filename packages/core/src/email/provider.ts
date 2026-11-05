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
};

export type EmailProvider = { send: (message: EmailMessage) => Promise<void> };

export type MailgunOptions = {
  apiKey: string;
  domain: string;
  region: 'us' | 'eu';
  from: string;
  fetch?: typeof fetch;
};

export function createMailgunProvider(options: MailgunOptions): EmailProvider {
  const host = options.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net';
  const url = `https://${host}/v3/${encodeURIComponent(options.domain)}/messages`;
  const authorization = `Basic ${Buffer.from(`api:${options.apiKey}`).toString('base64')}`;
  const send = options.fetch ?? fetch;

  // The address inside EMAIL_FROM, for a per-message display name.
  const address = /<([^>]+)>/.exec(options.from)?.[1] ?? options.from;

  return {
    async send(message) {
      const fields: Record<string, string> = {
        from: message.fromName
          ? `"${message.fromName.replaceAll('"', "'")}" <${address}>`
          : options.from,
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
      return Promise.resolve();
    },
  };
}
