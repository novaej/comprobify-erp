import { describe, expect, it, vi } from 'vitest';
import { createMailgunProvider, renderEmail, sendEmailHandler } from '.';

describe('renderEmail', () => {
  it('renders each template in both languages, with the link', () => {
    for (const locale of ['es', 'en'] as const) {
      for (const template of ['verifyEmail', 'resetPassword', 'invitation'] as const) {
        const message = renderEmail(template, locale, 'a@example.com', {
          url: 'https://app.test/x?token=t',
        });
        expect(message.subject).not.toBe('');
        expect(message.text).toContain('https://app.test/x?token=t');
        expect(message.html).toContain(`lang="${locale}"`);
      }
    }
  });

  it('escapes the link in HTML', () => {
    const message = renderEmail('verifyEmail', 'es', 'a@example.com', {
      url: 'https://app.test/"><script>',
    });
    expect(message.html).not.toContain('<script>');
  });
});

describe('invitation', () => {
  it('names the organization, escaped in HTML', () => {
    const message = renderEmail('invitation', 'es', 'a@example.com', {
      url: 'https://app.test/i',
      organization: 'Alfa & <Beta>',
    });
    expect(message.subject).toBe('Te invitaron a Alfa & <Beta> en Comprobify');
    expect(message.html).toContain('Alfa &amp; &lt;Beta&gt;');
    expect(message.html).not.toContain('<Beta>');
  });
});

describe('Mailgun provider', () => {
  it('posts the message with basic auth to the right region', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const provider = createMailgunProvider({
      apiKey: 'key-1',
      domain: 'mg.example.com',
      region: 'eu',
      from: 'C <no-reply@example.com>',
      fetch,
    });
    await provider.send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' });

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.eu.mailgun.net/v3/mg.example.com/messages');
    expect(init.headers).toEqual({ authorization: `Basic ${btoa('api:key-1')}` });
    expect((init.body as URLSearchParams).get('to')).toBe('a@example.com');
  });

  it('fails with the status only, so a retry follows', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('secret echo', { status: 500 }));
    const provider = createMailgunProvider({
      apiKey: 'k',
      domain: 'd',
      region: 'us',
      from: 'f',
      fetch,
    });
    await expect(
      provider.send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' }),
    ).rejects.toThrow('Mailgun answered 500');
  });
});

describe('email.send handler', () => {
  it('renders and sends', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await sendEmailHandler({ send })({
      data: {
        to: 'a@example.com',
        locale: 'en',
        template: 'resetPassword',
        params: { url: 'https://app.test/r' },
      },
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@example.com' }));
  });
});
