import { describe, expect, it, vi } from 'vitest';
import {
  createMailgunProvider,
  createNoEmailProvider,
  renderDocumentEmail,
  renderEmail,
  sendEmailHandler,
  withRedirect,
  withTestBanner,
  type EmailMessage,
} from '.';

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

describe('the buyer’s copy (FR-DOC-11)', () => {
  it('comes from the issuer via Comprobify, with the attachments as multipart', async () => {
    const message = renderDocumentEmail('maria@example.com', {
      organization: 'Alfa <S.A.>',
      ruc: '1790000000001',
      buyerName: 'María López',
      documentLabel: 'Factura',
      number: '001-001-000000001',
      issueDate: '10/11/2026',
      total: '127.00',
      authorizationNumber: '1011202601179000000100110010010000000011234567813',
      attachments: { ride: 'RIDE 001-001-000000001.pdf', xml: '1011202601.xml' },
      test: false,
    });
    expect(message.subject).toBe('Factura Electrónica N° 001-001-000000001 — Alfa <S.A.>');
    expect(message.html).toContain('Alfa &lt;S.A.&gt;');
    // The old app's layout: greeting, the facts, the attachments, the issuer.
    expect(message.text).toContain('Estimado/a María López,');
    expect(message.text).toContain(
      '  Número de autorización:  1011202601179000000100110010010000000011234567813',
    );
    expect(message.text).toContain(
      '  • RIDE 001-001-000000001.pdf: Representación impresa del comprobante (RIDE)',
    );
    expect(message.text).toContain('RUC: 1790000000001');
    expect(message.text).not.toContain('pruebas');
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const provider = createMailgunProvider({
      apiKey: 'key',
      domain: 'mg.example.com',
      region: 'us',
      from: 'Comprobify <no-reply@comprobify.com>',
      fetch,
    });
    await provider.send({
      ...message,
      attachments: [
        { filename: 'RIDE.pdf', content: Buffer.from('%PDF-'), contentType: 'application/pdf' },
      ],
      variables: { 'document-id': 'doc-1' },
    });
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('from')).toBe('"Alfa <S.A.> via Comprobify" <no-reply@comprobify.com>');
    expect(body.get('v:document-id')).toBe('doc-1');
    expect((body.get('attachment') as File).name).toBe('RIDE.pdf');
  });

  it('sends a document from EMAIL_FROM_DOCUMENTS, and the rest from EMAIL_FROM', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const provider = createMailgunProvider({
      apiKey: 'key',
      domain: 'mg.example.com',
      region: 'us',
      from: 'Comprobify <no-reply@comprobify.com>',
      documentsFrom: 'Comprobify <facturas@comprobify.com>',
      fetch,
    });
    await provider.send({
      ...renderEmail('verifyEmail', 'es', 'a@example.com', { url: 'https://x.test' }),
    });
    await provider.send({
      to: 'b@example.com',
      subject: 's',
      text: 't',
      html: 'h',
      fromName: 'Alfa',
      sender: 'documents',
    });
    const from = (call: number) =>
      new URLSearchParams(
        (fetch.mock.calls[call] as [string, RequestInit])[1].body as URLSearchParams,
      ).get('from');
    expect(from(0)).toBe('Comprobify <no-reply@comprobify.com>');
    expect(from(1)).toBe('"Alfa" <facturas@comprobify.com>');
  });
});

describe('test recipient, banner and off switch (ADR-015)', () => {
  const capture = () => {
    const sent: EmailMessage[] = [];
    return {
      sent,
      provider: {
        send: (message: EmailMessage) => (sent.push(message), Promise.resolve('sent' as const)),
      },
    };
  };

  it('redirects every email to one address, saying who it was for', async () => {
    const { sent, provider } = capture();
    const result = await withRedirect(provider, 'owner@example.com').send(
      renderEmail('verifyEmail', 'es', 'maria@example.com', { url: 'https://x.test' }),
    );
    expect(result).toBe('sent');
    expect(sent[0]).toMatchObject({ to: 'owner@example.com' });
    expect(sent[0]!.subject).toMatch(/^\[REDIRIGIDO\] /);
    expect(sent[0]!.text).toContain('Este correo habría sido enviado a: maria@example.com');
    expect(sent[0]!.html).toContain('maria@example.com');
  });

  it('marks staging emails, and sends nothing when off', async () => {
    const { sent, provider } = capture();
    await withTestBanner(provider).send(
      renderEmail('verifyEmail', 'en', 'a@example.com', { url: 'https://x.test' }),
    );
    expect(sent[0]!.text).toMatch(/^TEST ENVIRONMENT/);
    await expect(createNoEmailProvider().send(sent[0]!)).resolves.toBe('skipped');
  });
});
