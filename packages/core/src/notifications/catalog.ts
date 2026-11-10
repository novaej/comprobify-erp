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
};

export type Catalogue = Record<NotificationType, NotificationSpec>;
