import type { Logger } from '@comprobify/config/logger';

export type EmailMessage = { to: string; subject: string; text: string; html: string };

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

  return {
    async send(message) {
      const body = new URLSearchParams({ from: options.from, ...message });
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
      logger.info(`Email to ${message.to}: ${message.subject}\n${message.text}`, {
        event: 'email.logged',
      });
      return Promise.resolve();
    },
  };
}
