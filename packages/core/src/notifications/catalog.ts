import type { NotificationChannel, NotificationType } from '@comprobify/db';
import type { EmailTemplate } from '../email';
import type { Permission } from '../tenancy';

// FR-NOT-1, FR-NOT-2 (ADR-036): what each notification is, decided here and never by the user.
export type NotificationSpec = {
  // The channels it can use. A member can only switch these.
  channels: readonly NotificationChannel[];
  // Which of them are on until the member says otherwise.
  defaults: readonly NotificationChannel[];
  // Can't be turned off: its channels are always on.
  mandatory: boolean;
  // The permission a member needs to receive it, so a role sees only what it can act on.
  audience: Permission;
  // The email's template, when the type has the email channel.
  emailTemplate: EmailTemplate | null;
  // Where it leads, without the language prefix.
  link: string;
};

const BOTH = ['IN_APP', 'EMAIL'] as const;

// A billing notice: both channels, on by default, to whoever manages the company's billing.
const billing = (emailTemplate: EmailTemplate): NotificationSpec => ({
  channels: BOTH,
  defaults: BOTH,
  mandatory: false,
  audience: 'billing.manage',
  emailTemplate,
  link: '/plan',
});

// What happened to a document or a batch: both channels on, to whoever issues documents.
const documents = (emailTemplate: EmailTemplate, link = '/documents'): NotificationSpec => ({
  channels: BOTH,
  defaults: BOTH,
  mandatory: false,
  audience: 'documents.issue',
  emailTemplate,
  link,
});

// In the app only: a log of what went well, not worth an email.
// A company-level warning about something that stops it issuing: both channels, to whoever
// manages the company.
const warning = (
  emailTemplate: EmailTemplate,
  audience: NotificationSpec['audience'],
  link: string,
): NotificationSpec => ({
  channels: BOTH,
  defaults: BOTH,
  mandatory: false,
  audience,
  emailTemplate,
  link,
});

const inAppOnly = (
  defaults: NotificationSpec['defaults'],
  audience: NotificationSpec['audience'],
): NotificationSpec => ({
  channels: ['IN_APP'],
  defaults,
  mandatory: false,
  audience,
  emailTemplate: null,
  link: '/documents',
});

// Typed over the names in the schema, so a type can't be added in one place only.
export const NOTIFICATIONS: Record<NotificationType, NotificationSpec> = {
  RENEWAL_DUE: billing('renewalDue'),
  GRACE_STARTED: billing('graceStarted'),
  PAST_DUE: billing('pastDue'),
  MOVED_TO_FREE: billing('movedToFree'),
  PAYMENT_REPRICED: billing('paymentRepriced'),
  RENEWAL_REPRICED: billing('renewalRepriced'),
  PAYMENT_VERIFIED: billing('paymentVerified'),
  PAYMENT_REJECTED: billing('paymentRejected'),
  DOCUMENT_REJECTED: documents('documentRejected'),
  DOCUMENT_SEND_FAILED: documents('documentSendFailed'),
  DOCUMENT_OVERDUE: documents('documentOverdue'),
  DOCUMENT_REISSUED: inAppOnly(['IN_APP'], 'documents.issue'),
  // One notice with a count per minute, off until a member asks for it (a company authorizing
  // hundreds a day would drown in them).
  DOCUMENTS_AUTHORIZED: inAppOnly([], 'documents.read'),
  BATCH_COMPLETED: documents('batchCompleted', '/bulk-invoicing'),
  CERTIFICATE_EXPIRING: warning('certificateExpiring', 'organization.manage', '/settings'),
  CERTIFICATE_EXPIRED: warning('certificateExpired', 'organization.manage', '/settings'),
  QUOTA_NEARING: warning('quotaNearing', 'billing.manage', '/plan'),
  QUOTA_REACHED: warning('quotaReached', 'billing.manage', '/plan'),
};

export type Catalogue = Record<NotificationType, NotificationSpec>;
