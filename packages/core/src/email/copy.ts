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
    documentRejected: {
      subject: 'SRI no autorizó el documento {number} de {organization}',
      heading: 'El documento {number} no fue autorizado',
      body: 'SRI no aceptó el documento {number}. Ábrelo para ver el motivo y corregirlo: se reenvía con el mismo número.',
      button: 'Ver el documento',
      footer: '',
    },
    documentSendFailed: {
      subject: 'El documento {number} de {organization} no llegó al SRI',
      heading: 'No pudimos enviar el documento {number}',
      body: 'El documento {number} no llegó al SRI el día de su emisión. Ábrelo para emitirlo de nuevo con la fecha de hoy o corregirlo.',
      button: 'Ver el documento',
      footer: '',
    },
    documentOverdue: {
      subject: 'El SRI no responde por el documento {number} de {organization}',
      heading: 'El SRI aún no responde por {number}',
      body: 'Pasaron 24 horas desde que el SRI recibió el documento {number} y no hay respuesta. Sigue siendo del SRI: lo revisamos de nuevo cada cierto tiempo.',
      button: 'Ver el documento',
      footer: '',
    },
    batchCompleted: {
      subject: 'Terminó el lote de {organization}: {count} facturas',
      heading: 'Terminó tu lote de facturas',
      body: 'Las {count} facturas del lote ya tienen respuesta del SRI. Revisa cuáles quedaron sin autorizar.',
      button: 'Ver el lote',
      footer: '',
    },
    certificateExpiring: {
      subject: 'La firma electrónica de {organization} vence en {count} días',
      heading: 'Tu firma electrónica vence pronto',
      body: 'El certificado de {organization} vence el {date}, en {count} días. Después de esa fecha no podrás emitir documentos: sube el certificado renovado antes.',
      button: 'Subir el certificado',
      footer: '',
    },
    certificateExpired: {
      subject: 'La firma electrónica de {organization} venció',
      heading: 'Tu firma electrónica venció',
      body: 'El certificado de {organization} venció el {date} y ya no se pueden emitir documentos. Sube el certificado renovado para volver a facturar.',
      button: 'Subir el certificado',
      footer: '',
    },
    quotaNearing: {
      subject: '{organization} va por el 80 % de sus documentos',
      heading: 'Se acerca el límite de documentos',
      body: 'Ya usaste el 80 % de los {count} documentos de este período. Al llegar al límite se gastan los documentos de tus paquetes y, si no quedan, no podrás emitir.',
      button: 'Ver el plan',
      footer: '',
    },
    quotaReached: {
      subject: '{organization} llegó al límite de documentos',
      heading: 'Llegaste al límite de documentos',
      body: 'Ya usaste los {count} documentos de este período. Desde ahora se gastan los de tus paquetes y, si no quedan, no podrás emitir hasta el siguiente período. Compra un paquete o cambia de plan.',
      button: 'Ver el plan',
      footer: '',
    },
    priceRise: {
      subject: 'Cambia el precio de {name} para {organization}',
      heading: 'Cambia un precio de tu suscripción',
      body: 'El precio de {name} cambia desde el {date}. Hasta esa fecha sigues pagando el precio actual. Revisa el nuevo precio en tu plan.',
      button: 'Ver el plan',
      footer: '',
    },
    planContentLeaving: {
      subject: '{name} cambia en el plan de {organization}',
      heading: 'Cambia lo que incluye tu plan',
      body: 'Desde el {date}, {name} deja de incluir algunas funciones en tu plan. Hasta entonces todo sigue igual. Si lo necesitas, revisa tus opciones en el plan.',
      button: 'Ver el plan',
      footer: '',
    },
    planLimitLowering: {
      subject: 'Baja un límite del plan de {organization}',
      heading: 'Baja un límite de tu plan',
      body: 'Desde el {date}, tu plan permite {count} {name}. Hasta entonces el límite sigue igual.',
      button: 'Ver el plan',
      footer: '',
    },
    paymentReported: {
      subject: '{organization} reportó un pago de {amount}',
      heading: 'Hay un pago por revisar',
      body: '{organization} reportó una transferencia de {amount}. Revisa el comprobante y verifícala o recházala.',
      button: 'Revisar pagos',
      footer: '',
    },
    cardPaymentApplied: {
      subject: '{organization} pagó {amount} con tarjeta',
      heading: 'Se aplicó un pago con tarjeta',
      body: '{organization} pagó {amount} con tarjeta y su plan ya está al día. Falta registrar la factura de este cobro.',
      button: 'Ver pagos',
      footer: '',
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
    documentRejected: {
      subject: 'SRI did not authorize document {number} of {organization}',
      heading: 'Document {number} was not authorized',
      body: 'SRI did not accept document {number}. Open it to see why and correct it: it is sent again with the same number.',
      button: 'View the document',
      footer: '',
    },
    documentSendFailed: {
      subject: 'Document {number} of {organization} did not reach SRI',
      heading: 'We could not send document {number}',
      body: 'Document {number} did not reach SRI on its issue day. Open it to issue it again with today’s date or to correct it.',
      button: 'View the document',
      footer: '',
    },
    documentOverdue: {
      subject: 'SRI has not answered for document {number} of {organization}',
      heading: 'SRI has not answered for {number} yet',
      body: '24 hours have passed since SRI received document {number} and there is no answer. SRI still holds it: we check again from time to time.',
      button: 'View the document',
      footer: '',
    },
    batchCompleted: {
      subject: 'The batch of {organization} is done: {count} invoices',
      heading: 'Your batch of invoices is done',
      body: 'All {count} invoices in the batch have SRI’s answer. Check which ones were not authorized.',
      button: 'View the batch',
      footer: '',
    },
    certificateExpiring: {
      subject: 'The electronic signature of {organization} expires in {count} days',
      heading: 'Your electronic signature expires soon',
      body: 'The certificate of {organization} expires on {date}, in {count} days. After that you will not be able to issue documents: upload the renewed certificate before then.',
      button: 'Upload the certificate',
      footer: '',
    },
    certificateExpired: {
      subject: 'The electronic signature of {organization} has expired',
      heading: 'Your electronic signature has expired',
      body: 'The certificate of {organization} expired on {date} and documents can no longer be issued. Upload the renewed certificate to invoice again.',
      button: 'Upload the certificate',
      footer: '',
    },
    quotaNearing: {
      subject: '{organization} has used 80 % of its documents',
      heading: 'You are nearing the document limit',
      body: 'You have used 80 % of the {count} documents of this period. At the limit, documents from your packs are spent and, if none are left, you will not be able to issue.',
      button: 'View the plan',
      footer: '',
    },
    quotaReached: {
      subject: '{organization} has reached its document limit',
      heading: 'You have reached the document limit',
      body: 'You have used all {count} documents of this period. From now on those in your packs are spent and, if none are left, you will not be able to issue until the next period. Buy a pack or change plan.',
      button: 'View the plan',
      footer: '',
    },
    priceRise: {
      subject: 'The price of {name} changes for {organization}',
      heading: 'A price in your subscription changes',
      body: 'The price of {name} changes from {date}. Until then you keep paying the current price. See the new price on your plan.',
      button: 'View the plan',
      footer: '',
    },
    planContentLeaving: {
      subject: '{name} changes in the plan of {organization}',
      heading: 'What your plan includes is changing',
      body: 'From {date}, {name} no longer includes some functions in your plan. Until then everything stays the same. If you need them, look at your options on the plan page.',
      button: 'View the plan',
      footer: '',
    },
    planLimitLowering: {
      subject: 'A limit of the plan of {organization} is going down',
      heading: 'A limit of your plan is going down',
      body: 'From {date}, your plan allows {count} {name}. Until then the limit stays the same.',
      button: 'View the plan',
      footer: '',
    },
    paymentReported: {
      subject: '{organization} reported a payment of {amount}',
      heading: 'A payment is waiting for review',
      body: '{organization} reported a transfer of {amount}. Check the proof and verify or reject it.',
      button: 'Review payments',
      footer: '',
    },
    cardPaymentApplied: {
      subject: '{organization} paid {amount} by card',
      heading: 'A card payment was applied',
      body: '{organization} paid {amount} by card and its plan is up to date. The invoice for this charge is still to be recorded.',
      button: 'View payments',
      footer: '',
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
  documentRejected: { allowed: ['organization', 'number'], required: ['number'] },
  documentSendFailed: { allowed: ['organization', 'number'], required: ['number'] },
  documentOverdue: { allowed: ['organization', 'number'], required: ['number'] },
  batchCompleted: { allowed: ['organization', 'count'], required: ['count'] },
  certificateExpiring: {
    allowed: ['organization', 'date', 'count'],
    required: ['date', 'count'],
  },
  certificateExpired: { allowed: ['organization', 'date'], required: ['date'] },
  quotaNearing: { allowed: ['organization', 'count'], required: ['count'] },
  quotaReached: { allowed: ['organization', 'count'], required: ['count'] },
  priceRise: { allowed: ['organization', 'name', 'date'], required: ['name', 'date'] },
  planContentLeaving: { allowed: ['organization', 'name', 'date'], required: ['name', 'date'] },
  planLimitLowering: {
    allowed: ['organization', 'name', 'date', 'count'],
    required: ['name', 'date', 'count'],
  },
  paymentReported: { allowed: ['organization', 'amount'], required: ['amount'] },
  cardPaymentApplied: { allowed: ['organization', 'amount'], required: ['amount'] },
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
