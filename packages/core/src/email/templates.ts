import { z } from 'zod';
import type { EmailMessage } from './provider';

export const emailLocale = z.enum(['es', 'en']);
export type EmailLocale = z.output<typeof emailLocale>;

export const emailTemplate = z.enum([
  'verifyEmail',
  'resetPassword',
  'invitation',
  // FR-BILL-5 (ADR-032): the renewal cycle, to the company's owner and admins.
  'renewalDue',
  'graceStarted',
  'pastDue',
  'movedToFree',
  // ADR-034: a new IVA rate changed an unpaid payment's total.
  'paymentRepriced',
  // ADR-035: the operator changed what the next period costs.
  'renewalRepriced',
]);
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
    renewalDue: {
      subject: 'La suscripción de {organization} se renueva el {date}',
      heading: 'Se acerca la renovación de {organization}',
      body: 'La suscripción se renueva el {date} por {amount}, IVA incluido. Paga antes de esa fecha para seguir sin interrupciones.',
      button: 'Ver el pago',
      footer: 'Si ya pagaste, ignora este mensaje.',
    },
    graceStarted: {
      subject: 'El pago de {organization} está pendiente',
      heading: 'La renovación de {organization} no está pagada',
      body: 'El período terminó y el pago de {amount} sigue pendiente. Sigues trabajando con normalidad hasta el {date}; desde entonces solo podrás consultar tus datos y pagar.',
      button: 'Pagar ahora',
      footer: 'Si ya enviaste el comprobante, lo estamos revisando.',
    },
    pastDue: {
      subject: 'La suscripción de {organization} está vencida',
      heading: 'La suscripción de {organization} está vencida',
      body: 'No recibimos el pago de {amount}. Desde hoy solo puedes consultar tus datos y pagar. Si no pagas hasta el {date}, la empresa pasará al plan Gratis.',
      button: 'Pagar ahora',
      footer: 'Si ya enviaste el comprobante, lo estamos revisando.',
    },
    movedToFree: {
      subject: '{organization} pasó al plan Gratis',
      heading: '{organization} está en el plan Gratis',
      body: 'Desde el {date}, la empresa está en el plan Gratis. Sus datos siguen aquí, con los límites de ese plan, y puedes volver a un plan de pago cuando quieras.',
      button: 'Ver los planes',
      footer: 'Los paquetes de comprobantes que tenías siguen disponibles.',
    },
    paymentRepriced: {
      subject: 'Cambió el IVA de tu pago pendiente en {organization}',
      heading: 'Tu pago pendiente tiene un nuevo total',
      body: 'Desde el {date}, el IVA es del {rate}. Tu pago pendiente ahora es de {amount}, IVA incluido. Si pagas por transferencia, transfiere este nuevo valor.',
      button: 'Ver el pago',
      footer:
        'Si ya enviaste el comprobante de una transferencia, no cambia: lo estamos revisando.',
    },
    renewalRepriced: {
      subject: 'Cambió el valor de la renovación de {organization}',
      heading: 'Tu renovación tiene un nuevo valor',
      body: 'Desde el {date}, la renovación de tu plan es de {amount}, IVA incluido, como acordamos contigo. Si pagas por transferencia, transfiere este nuevo valor.',
      button: 'Ver el pago',
      footer: 'Si tienes preguntas sobre este valor, responde a quien te atiende en Comprobify.',
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
    renewalDue: {
      subject: "{organization}'s subscription renews on {date}",
      heading: "{organization}'s renewal is coming up",
      body: 'The subscription renews on {date} for {amount}, VAT included. Pay before then to keep working without interruption.',
      button: 'View the payment',
      footer: 'If you already paid, ignore this message.',
    },
    graceStarted: {
      subject: "{organization}'s payment is pending",
      heading: "{organization}'s renewal isn't paid",
      body: 'The period ended and the payment of {amount} is still pending. You can keep working as usual until {date}; after that you can only view your data and pay.',
      button: 'Pay now',
      footer: "If you already sent the proof, we're reviewing it.",
    },
    pastDue: {
      subject: "{organization}'s subscription is past due",
      heading: "{organization}'s subscription is past due",
      body: "We didn't receive the payment of {amount}. From today you can only view your data and pay. If it isn't paid by {date}, the company moves to the Free plan.",
      button: 'Pay now',
      footer: "If you already sent the proof, we're reviewing it.",
    },
    movedToFree: {
      subject: '{organization} moved to the Free plan',
      heading: '{organization} is on the Free plan',
      body: "Since {date}, the company is on the Free plan. Its data is still here, within that plan's limits, and you can return to a paid plan whenever you like.",
      button: 'View the plans',
      footer: 'Any document packs you had are still available.',
    },
    paymentRepriced: {
      subject: "The VAT on {organization}'s open payment changed",
      heading: 'Your open payment has a new total',
      body: 'Since {date}, VAT is {rate}. Your open payment is now {amount}, VAT included. If you pay by transfer, transfer this new amount.',
      button: 'View the payment',
      footer: "If you already sent a transfer's proof, it doesn't change: we're reviewing it.",
    },
    renewalRepriced: {
      subject: "{organization}'s renewal has a new amount",
      heading: 'Your renewal has a new amount',
      body: 'Since {date}, your plan renews for {amount}, VAT included, as agreed with you. If you pay by transfer, transfer this new amount.',
      button: 'View the payment',
      footer: 'If you have questions about this amount, reply to your contact at Comprobify.',
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

export type EmailParams = {
  url: string;
  organization?: string | undefined;
  // Already formatted for the locale: a date and an amount with its currency.
  date?: string | undefined;
  amount?: string | undefined;
  rate?: string | undefined;
};

export function renderEmail(
  template: EmailTemplate,
  locale: EmailLocale,
  to: string,
  params: EmailParams,
): EmailMessage {
  // Filled before escaping, so an organization name can't inject HTML.
  const fill = (text: string) =>
    text
      .replaceAll('{organization}', params.organization ?? '')
      .replaceAll('{date}', params.date ?? '')
      .replaceAll('{amount}', params.amount ?? '')
      .replaceAll('{rate}', params.rate ?? '');
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
