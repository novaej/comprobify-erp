import { z } from 'zod';
import type { EmailMessage } from './provider';

export const emailLocale = z.enum(['es', 'en']);
export type EmailLocale = z.output<typeof emailLocale>;

export const emailTemplate = z.enum(['verifyEmail', 'resetPassword', 'invitation']);
export type EmailTemplate = z.output<typeof emailTemplate>;

type Copy = { subject: string; heading: string; body: string; button: string; footer: string };

// Code templates until Milestone 9 moves them to the database (FR-NOT-3).
const COPY: Record<EmailLocale, Record<EmailTemplate, Copy>> = {
  es: {
    verifyEmail: {
      subject: 'Confirma tu correo en Comprobify',
      heading: 'Confirma tu correo electrónico',
      body: 'Para terminar de crear tu cuenta, confirma que este correo es tuyo.',
      button: 'Confirmar mi correo',
      footer: 'Si no creaste una cuenta en Comprobify, ignora este mensaje.',
    },
    invitation: {
      subject: 'Te invitaron a {organization} en Comprobify',
      heading: 'Te invitaron a {organization}',
      body: 'Acepta la invitación para trabajar con {organization} en Comprobify. El enlace vence en 7 días.',
      button: 'Ver la invitación',
      footer: 'Si no esperabas esta invitación, ignora este mensaje.',
    },
    resetPassword: {
      subject: 'Restablece tu contraseña de Comprobify',
      heading: 'Restablece tu contraseña',
      body: 'Recibimos una solicitud para restablecer tu contraseña. El enlace vence en una hora.',
      button: 'Elegir una nueva contraseña',
      footer: 'Si no lo solicitaste, ignora este mensaje: tu contraseña no cambia.',
    },
  },
  en: {
    verifyEmail: {
      subject: 'Confirm your email for Comprobify',
      heading: 'Confirm your email',
      body: 'To finish creating your account, confirm that this email is yours.',
      button: 'Confirm my email',
      footer: "If you didn't create a Comprobify account, ignore this message.",
    },
    invitation: {
      subject: "You're invited to {organization} on Comprobify",
      heading: "You're invited to {organization}",
      body: 'Accept the invitation to work with {organization} on Comprobify. The link expires in 7 days.',
      button: 'View the invitation',
      footer: "If you weren't expecting this invitation, ignore this message.",
    },
    resetPassword: {
      subject: 'Reset your Comprobify password',
      heading: 'Reset your password',
      body: 'We received a request to reset your password. The link expires in one hour.',
      button: 'Choose a new password',
      footer: "If you didn't ask for this, ignore this message: your password won't change.",
    },
  },
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export type EmailParams = { url: string; organization?: string | undefined };

export function renderEmail(
  template: EmailTemplate,
  locale: EmailLocale,
  to: string,
  params: EmailParams,
): EmailMessage {
  // Filled before escaping, so an organization name can't inject HTML.
  const fill = (text: string) => text.replaceAll('{organization}', params.organization ?? '');
  const base = COPY[locale][template];
  const copy = {
    subject: fill(base.subject),
    heading: fill(base.heading),
    body: fill(base.body),
    button: fill(base.button),
    footer: fill(base.footer),
  };
  const url = escapeHtml(params.url);
  const text = `${copy.heading}\n\n${copy.body}\n\n${params.url}\n\n${copy.footer}`;
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:system-ui,sans-serif;color:#232b36">
<h1 style="font-size:20px">${escapeHtml(copy.heading)}</h1>
<p>${escapeHtml(copy.body)}</p>
<p><a href="${url}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(copy.button)}</a></p>
<p style="font-size:12px;color:#5b6573">${escapeHtml(copy.footer)}</p>
</body></html>`;
  return { to, subject: copy.subject, text, html, locale };
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

// FR-DOC-11: the buyer's copy, RIDE and XML attached, in the old app's layout: greeting,
// the document's facts, the attachments, the issuer. Spanish: the document is.
export function renderDocumentEmail(to: string, params: DocumentEmailParams): EmailMessage {
  const subject = `${params.test ? '[PRUEBAS] ' : ''}${params.documentLabel} Electrónica N° ${params.number} — ${params.organization}`;
  const greeting = `Estimado/a ${params.buyerName},`;
  const intro =
    'Nos complacemos en informarle que su comprobante electrónico ha sido autorizado por el SRI.';
  const test = params.test
    ? 'Este es un comprobante del ambiente de pruebas del SRI y no tiene validez tributaria.'
    : null;
  const facts: [string, string][] = [
    [`${params.documentLabel} N°`, params.number],
    ['Fecha de emisión', params.issueDate],
    ['Total', `$${params.total}`],
    ['Número de autorización', params.authorizationNumber],
  ];
  const attachments: [string, string][] = [
    [params.attachments.ride, 'Representación impresa del comprobante (RIDE)'],
    [params.attachments.xml, 'Comprobante electrónico (XML autorizado)'],
  ];
  const thanks = 'Gracias por su preferencia.';
  const disclaimer =
    'No responda a este correo: es un mensaje automático enviado por Comprobify en nombre del emisor.';

  const text = [
    greeting,
    '',
    intro,
    ...(test ? ['', test] : []),
    '',
    ...facts.map(([label, value]) => `  ${label}:  ${value}`),
    '',
    'Adjunto encontrará los siguientes documentos:',
    ...attachments.map(([file, what]) => `  • ${file}: ${what}`),
    '',
    thanks,
    '',
    params.organization,
    `RUC: ${params.ruc}`,
    '',
    disclaimer,
  ].join('\n');

  const cell = 'padding:6px 12px;border-bottom:1px solid #eee';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(intro)}</p>
${test ? `<p style="background:#fff3cd;padding:10px 12px;border-radius:6px">${escapeHtml(test)}</p>` : ''}
<table style="border-collapse:collapse;width:100%;margin:16px 0">
${facts.map(([label, value]) => `<tr><td style="${cell};background:#f5f5f5;font-weight:bold;width:45%">${escapeHtml(label)}</td><td style="${cell}">${escapeHtml(value)}</td></tr>`).join('\n')}
</table>
<p>Adjunto encontrará los siguientes documentos:</p>
<ul>
${attachments.map(([file, what]) => `<li><strong>${escapeHtml(file)}</strong>: ${escapeHtml(what)}</li>`).join('\n')}
</ul>
<p>${escapeHtml(thanks)}</p>
<hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
<p style="font-size:12px;color:#666"><strong>${escapeHtml(params.organization)}</strong><br>RUC: ${escapeHtml(params.ruc)}</p>
<p style="font-size:11px;color:#999">${escapeHtml(disclaimer)}</p>
</body></html>`;
  return {
    to,
    subject,
    text,
    html,
    fromName: `${params.organization} via Comprobify`,
    sender: 'documents',
    locale: 'es',
  };
}
