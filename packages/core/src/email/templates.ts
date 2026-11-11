import { EMAIL_TEMPLATES } from '@comprobify/db';
import { z } from 'zod';
import { DEFAULT_COPY, type Copy } from './copy';
import type { EmailMessage } from './provider';

export const emailLocale = z.enum(['es', 'en']);
export type EmailLocale = z.output<typeof emailLocale>;

export const emailTemplate = z.enum(EMAIL_TEMPLATES);
export type EmailTemplate = z.output<typeof emailTemplate>;

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export type EmailParams = {
  url: string;
  organization?: string | undefined;
  // Already formatted for the locale: a date and an amount with its currency.
  date?: string | undefined;
  amount?: string | undefined;
  rate?: string | undefined;
  // A rejection's code, written out in the reader's language.
  reason?: string | undefined;
  number?: string | undefined;
  count?: string | undefined;
};

const REJECTION_REASONS: Record<EmailLocale, Record<string, string>> = {
  es: {
    AMOUNT_MISMATCH: 'el valor no coincide',
    TRANSFER_NOT_FOUND: 'no encontramos la transferencia',
    WRONG_ACCOUNT: 'se transfirió a otra cuenta',
    ILLEGIBLE_PROOF: 'el comprobante no se lee',
    DUPLICATE_SUBMISSION: 'ese comprobante ya se usó',
    OTHER: 'escríbenos para saber más',
  },
  en: {
    AMOUNT_MISMATCH: "the amount doesn't match",
    TRANSFER_NOT_FOUND: "we couldn't find the transfer",
    WRONG_ACCOUNT: 'it went to another account',
    ILLEGIBLE_PROOF: "the proof can't be read",
    DUPLICATE_SUBMISSION: 'that proof was already used',
    OTHER: 'write to us to find out more',
  },
};

export function renderEmail(
  template: EmailTemplate,
  locale: EmailLocale,
  to: string,
  params: EmailParams,
  // The version in use, from the database (ADR-037); the starting text when none is given.
  copy: Copy = DEFAULT_COPY[locale][template],
): EmailMessage {
  // Filled before escaping, so an organization name can't inject HTML.
  const fill = (text: string) =>
    text
      .replaceAll('{organization}', params.organization ?? '')
      .replaceAll('{date}', params.date ?? '')
      .replaceAll('{amount}', params.amount ?? '')
      .replaceAll('{rate}', params.rate ?? '')
      .replaceAll('{number}', params.number ?? '')
      .replaceAll('{count}', params.count ?? '')
      .replaceAll(
        '{reason}',
        params.reason ? (REJECTION_REASONS[locale][params.reason] ?? params.reason) : '',
      );
  const filled = {
    subject: fill(copy.subject),
    heading: fill(copy.heading),
    body: fill(copy.body),
    button: fill(copy.button),
    footer: fill(copy.footer),
  };
  const url = escapeHtml(params.url);
  const text = [filled.heading, filled.body, params.url, filled.footer]
    .filter((part) => part !== '')
    .join('\n\n');
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:system-ui,sans-serif;color:#232b36">
<h1 style="font-size:20px">${escapeHtml(filled.heading)}</h1>
<p>${escapeHtml(filled.body)}</p>
<p><a href="${url}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(filled.button)}</a></p>
${filled.footer ? `<p style="font-size:12px;color:#5b6573">${escapeHtml(filled.footer)}</p>` : ''}
</body></html>`;
  return { to, subject: filled.subject, text, html, locale };
}

export type DocumentEmailParams = {
  organization: string;
  ruc: string;
  buyerName: string;
  documentLabel: string;
  number: string;
  issueDate: string;
  total: string;
  authorizationNumber: string;
  attachments: { ride: string; xml: string };
  // SRI test environment: the buyer is told it has no tax validity.
  test: boolean;
};

// What the company's papers say to the other party: a greeting, the facts, the files, the
// company, in the old app's layout. Spanish: the papers are.
type BusinessEmail = {
  subject: string;
  greeting: string;
  intro: string;
  notice: string | null;
  facts: [string, string][];
  attachmentsIntro: string;
  attachments: [string, string | null][];
  closing: string;
  organization: string;
  ruc: string;
};

const DISCLAIMER =
  'No responda a este correo: es un mensaje automático enviado por Comprobify en nombre del emisor.';

function businessEmail(to: string, email: BusinessEmail): EmailMessage {
  const fileLine = ([file, what]: [string, string | null]) => (what ? `${file}: ${what}` : file);
  const text = [
    email.greeting,
    '',
    email.intro,
    ...(email.notice ? ['', email.notice] : []),
    '',
    ...email.facts.map(([label, value]) => `  ${label}:  ${value}`),
    '',
    email.attachmentsIntro,
    ...email.attachments.map((item) => `  • ${fileLine(item)}`),
    '',
    email.closing,
    '',
    email.organization,
    `RUC: ${email.ruc}`,
    '',
    DISCLAIMER,
  ].join('\n');

  const cell = 'padding:6px 12px;border-bottom:1px solid #eee';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
<p>${escapeHtml(email.greeting)}</p>
<p>${escapeHtml(email.intro)}</p>
${email.notice ? `<p style="background:#fff3cd;padding:10px 12px;border-radius:6px">${escapeHtml(email.notice)}</p>` : ''}
<table style="border-collapse:collapse;width:100%;margin:16px 0">
${email.facts.map(([label, value]) => `<tr><td style="${cell};background:#f5f5f5;font-weight:bold;width:45%">${escapeHtml(label)}</td><td style="${cell}">${escapeHtml(value)}</td></tr>`).join('\n')}
</table>
<p>${escapeHtml(email.attachmentsIntro)}</p>
<ul>
${email.attachments.map(([file, what]) => `<li><strong>${escapeHtml(file)}</strong>${what ? `: ${escapeHtml(what)}` : ''}</li>`).join('\n')}
</ul>
<p>${escapeHtml(email.closing)}</p>
<hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
<p style="font-size:12px;color:#666"><strong>${escapeHtml(email.organization)}</strong><br>RUC: ${escapeHtml(email.ruc)}</p>
<p style="font-size:11px;color:#999">${escapeHtml(DISCLAIMER)}</p>
</body></html>`;
  return {
    to,
    subject: email.subject,
    text,
    html,
    fromName: `${email.organization} via Comprobify`,
    sender: 'documents',
    locale: 'es',
  };
}

// FR-DOC-11: the buyer's copy, RIDE and XML attached.
export function renderDocumentEmail(to: string, params: DocumentEmailParams): EmailMessage {
  return businessEmail(to, {
    subject: `${params.test ? '[PRUEBAS] ' : ''}${params.documentLabel} Electrónica N° ${params.number} — ${params.organization}`,
    greeting: `Estimado/a ${params.buyerName},`,
    intro:
      'Nos complacemos en informarle que su comprobante electrónico ha sido autorizado por el SRI.',
    notice: params.test
      ? 'Este es un comprobante del ambiente de pruebas del SRI y no tiene validez tributaria.'
      : null,
    facts: [
      [`${params.documentLabel} N°`, params.number],
      ['Fecha de emisión', params.issueDate],
      ['Total', `$${params.total}`],
      ['Número de autorización', params.authorizationNumber],
    ],
    attachmentsIntro: 'Adjunto encontrará los siguientes documentos:',
    attachments: [
      [params.attachments.ride, 'Representación impresa del comprobante (RIDE)'],
      [params.attachments.xml, 'Comprobante electrónico (XML autorizado)'],
    ],
    closing: 'Gracias por su preferencia.',
    organization: params.organization,
    ruc: params.ruc,
  });
}

export type PurchaseOrderEmailParams = {
  organization: string;
  ruc: string;
  providerName: string;
  number: string;
  orderDate: string;
  expectedDate: string | null;
  total: string;
  attachment: string;
  // The company's test copy: the provider is told it isn't a real order.
  test: boolean;
};

// FR-PUR-3: the order to the provider, its PDF attached.
export function renderPurchaseOrderEmail(
  to: string,
  params: PurchaseOrderEmailParams,
): EmailMessage {
  return businessEmail(to, {
    subject: `${params.test ? '[PRUEBAS] ' : ''}Orden de compra ${params.number} — ${params.organization}`,
    greeting: `Estimado/a ${params.providerName},`,
    intro: `${params.organization} le envía la orden de compra ${params.number}.`,
    notice: params.test
      ? 'Esta orden viene del ambiente de pruebas de la empresa y no es un pedido real.'
      : null,
    facts: [
      ['Orden de compra', params.number],
      ['Fecha', params.orderDate],
      ...(params.expectedDate
        ? ([['Entrega prevista', params.expectedDate]] as [string, string][])
        : []),
      ['Total', `$${params.total}`],
    ],
    attachmentsIntro: 'Adjunto encontrará la orden en PDF:',
    attachments: [[params.attachment, null]],
    closing: 'Por favor, confirme la recepción del pedido y la fecha de entrega con la empresa.',
    organization: params.organization,
    ruc: params.ruc,
  });
}
