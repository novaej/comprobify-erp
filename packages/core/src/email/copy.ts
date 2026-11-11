import { z } from 'zod';
import type { EmailLocale, EmailTemplate } from './templates';

export type Copy = {
  subject: string;
  heading: string;
  body: string;
  button: string;
  footer: string;
};

// The texts the platform starts with, and the last fallback: the migrate step seeds them as
// version 1, and from then on the super admin's published versions are the ones sent (ADR-037).
export const DEFAULT_COPY: Record<EmailLocale, Record<EmailTemplate, Copy>> = {
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
    paymentVerified: {
      subject: 'Recibimos el pago de {organization}',
      heading: 'Tu pago está confirmado',
      body: 'Confirmamos tu pago de {amount}, IVA incluido. Lo que pagaste ya está activo en {organization}.',
      button: 'Ver el plan',
      footer: 'Te enviaremos la factura de este pago aparte.',
    },
    paymentRejected: {
      subject: 'No pudimos aceptar el comprobante de {organization}',
      heading: 'Tu comprobante fue rechazado',
      body: 'Revisamos el comprobante de tu pago de {amount} y no lo pudimos aceptar: {reason}. Envía uno nuevo o paga con tarjeta.',
      button: 'Ver el pago',
      footer: 'Si ya corregiste el problema, envía el comprobante otra vez desde el pago.',
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
    paymentVerified: {
      subject: "We received {organization}'s payment",
      heading: 'Your payment is confirmed',
      body: 'We confirmed your payment of {amount}, VAT included. What you paid for is now active in {organization}.',
      button: 'View the plan',
      footer: "We'll send you the invoice for this payment separately.",
    },
    paymentRejected: {
      subject: "We couldn't accept {organization}'s proof",
      heading: 'Your proof was rejected',
      body: "We reviewed the proof for your payment of {amount} and couldn't accept it: {reason}. Send a new one or pay by card.",
      button: 'View the payment',
      footer: 'If you already fixed the problem, send the proof again from the payment.',
    },
  },
};

// FR-NOT-3 (ADR-037): the words a template may use, as {name}. `allowed` is what the sender fills
// in; `required` is what the text can't do without, so a rewrite can't drop the amount of a
// payment or the date a deadline falls on.
export const TEMPLATE_PLACEHOLDERS: Record<
  EmailTemplate,
  { allowed: readonly string[]; required: readonly string[] }
> = {
  verifyEmail: { allowed: [], required: [] },
  resetPassword: { allowed: [], required: [] },
  invitation: { allowed: ['organization'], required: ['organization'] },
  renewalDue: { allowed: ['organization', 'date', 'amount'], required: ['date', 'amount'] },
  graceStarted: { allowed: ['organization', 'date', 'amount'], required: ['date', 'amount'] },
  pastDue: { allowed: ['organization', 'date', 'amount'], required: ['date', 'amount'] },
  movedToFree: { allowed: ['organization', 'date'], required: ['date'] },
  paymentRepriced: {
    allowed: ['organization', 'date', 'amount', 'rate'],
    required: ['date', 'amount', 'rate'],
  },
  renewalRepriced: { allowed: ['organization', 'date', 'amount'], required: ['date', 'amount'] },
  paymentVerified: { allowed: ['organization', 'amount'], required: ['amount'] },
  paymentRejected: {
    allowed: ['organization', 'amount', 'reason'],
    required: ['amount', 'reason'],
  },
};

export const copyInput = z.object({
  subject: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^\r\n]*$/),
  heading: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  button: z.string().trim().min(1).max(60),
  footer: z.string().trim().max(500),
});

const PLACEHOLDER = /\{([A-Za-z]+)\}/g;

// What a text asks for that its template can't give, and what it lacks that it can't do without.
export function placeholderProblems(
  template: EmailTemplate,
  copy: Copy,
): { unknown: string[]; missing: string[] } {
  const rules = TEMPLATE_PLACEHOLDERS[template];
  const used = new Set(
    [copy.subject, copy.heading, copy.body, copy.button, copy.footer].flatMap((text) =>
      [...text.matchAll(PLACEHOLDER)].map((match) => match[1]!),
    ),
  );
  return {
    unknown: [...used].filter((name) => !rules.allowed.includes(name)).sort(),
    missing: rules.required.filter((name) => !used.has(name)),
  };
}
