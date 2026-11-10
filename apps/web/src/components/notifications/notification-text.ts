'use client';

import { useLocale, useTranslations } from 'next-intl';

// What a notification, as the server hands it to a screen, needs to be written out.
export type NotificationItem = {
  id: string;
  type: string;
  params: Record<string, string>;
  link: string;
  environment: 'TEST' | 'PRODUCTION';
  createdAt: string;
  readAt: string | null;
};

// Notifications store a type and plain parameters, never text: it is written here, in the
// language the person is reading (ADR-036).
export function useNotificationText() {
  const t = useTranslations('notifications.types');
  const tReasons = useTranslations('plan.payment.reasons');
  const locale = useLocale();
  const date = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'long',
    timeZone: 'UTC',
  });
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Guayaquil',
  });
  return {
    when: (iso: string) => when.format(new Date(iso)),
    text: (item: NotificationItem): { title: string; body: string } => {
      const { params } = item;
      const values = {
        amount: params.amount ?? '',
        date: params.date ? date.format(new Date(`${params.date}T12:00:00Z`)) : '',
        rate: params.rate ? String(Number(params.rate)) : '',
        code: params.code ?? '',
        reason: params.reason && tReasons.has(params.reason) ? tReasons(params.reason) : '',
      };
      const key = item.type;
      return t.has(`${item.type}.title`)
        ? { title: t(`${key}.title`, values), body: t(`${key}.body`, values) }
        : { title: item.type, body: '' };
    },
  };
}
