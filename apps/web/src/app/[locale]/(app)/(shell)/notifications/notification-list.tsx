'use client';

import { Button } from '@comprobify/ui/components/button';
import { BellOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { EmptyState } from '@/components/empty-state';
import {
  useNotificationText,
  type NotificationItem,
} from '@/components/notifications/notification-text';
import {
  StackBody,
  StackCell,
  StackHead,
  StackHeader,
  StackRow,
  StackTable,
  TableCard,
} from '@/components/stack-table';
import { ToneBadge } from '@/components/tone-badge';
import { Link } from '@/i18n/navigation';
import { markAllReadAction, markReadAction } from './actions';

// FR-NOT-1: the member's notifications, each leading to what it is about.
export function NotificationList({
  items,
  unreadOnly,
}: {
  items: NotificationItem[];
  unreadOnly: boolean;
}) {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const { text, when } = useNotificationText();
  const [pending, startTransition] = useTransition();
  const hasUnread = items.some((item) => !item.readAt);

  const call = (action: typeof markReadAction, fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.set('locale', locale);
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    startTransition(async () => {
      await action({}, form);
    });
  };

  return (
    <>
      {hasUnread && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => call(markAllReadAction)}
          >
            {t('markAll')}
          </Button>
        </div>
      )}
      <TableCard>
        {items.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title={unreadOnly ? t('emptyUnreadTitle') : t('emptyTitle')}
            description={unreadOnly ? undefined : t('empty')}
          />
        ) : (
          <StackTable aria-label={t('listTitle')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.message')}</StackHead>
                <StackHead>{t('table.when')}</StackHead>
                <StackHead>{t('table.status')}</StackHead>
                <StackHead>
                  <span className="sr-only">{t('table.actions')}</span>
                </StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {items.map((item) => {
                const { title, body } = text(item);
                return (
                  <StackRow key={item.id}>
                    <StackCell heading className="pl-4">
                      <Link
                        href={item.link}
                        onClick={() => !item.readAt && call(markReadAction, { id: item.id })}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {title}
                      </Link>
                      {item.environment === 'TEST' && (
                        <span className="ml-2">
                          <ToneBadge tone="warning">{t('test')}</ToneBadge>
                        </span>
                      )}
                      {body && <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>}
                    </StackCell>
                    <StackCell label={t('table.when')}>{when(item.createdAt)}</StackCell>
                    <StackCell label={t('table.status')}>
                      <ToneBadge tone={item.readAt ? 'neutral' : 'primary'}>
                        {item.readAt ? t('read') : t('new')}
                      </ToneBadge>
                    </StackCell>
                    <StackCell className="text-right">
                      {!item.readAt && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => call(markReadAction, { id: item.id })}
                        >
                          {t('markRead')}
                        </Button>
                      )}
                    </StackCell>
                  </StackRow>
                );
              })}
            </StackBody>
          </StackTable>
        )}
      </TableCard>
    </>
  );
}
