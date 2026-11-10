'use client';

import { Button } from '@comprobify/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@comprobify/ui/components/popover';
import { cn } from '@comprobify/ui/lib/utils';
import { Bell } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import {
  markAllReadAction,
  markReadAction,
} from '@/app/[locale]/(app)/(shell)/notifications/actions';
import { Link } from '@/i18n/navigation';
import { ToneBadge } from '../tone-badge';
import { useNotificationText, type NotificationItem } from './notification-text';

// FR-NOT-1: the bell in the top bar. It shows how many are unread and the latest few; the count
// is read with the page and again after any change here, never by polling (mistake 16).
export function NotificationBell({ unread, items }: { unread: number; items: NotificationItem[] }) {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const { text, when } = useNotificationText();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const call = (action: typeof markReadAction, fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.set('locale', locale);
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    startTransition(async () => {
      await action({}, form);
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={unread > 0 ? t('bellUnread', { count: unread }) : t('bell')}
            title={t('bell')}
            className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        }
      >
        <Bell className="h-4 w-4" aria-hidden />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="text-sm font-semibold">{t('title')}</p>
          {unread > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => call(markAllReadAction)}
            >
              {t('markAll')}
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('emptyBell')}</p>
        ) : (
          <ul aria-label={t('title')} className="max-h-96 divide-y divide-border overflow-y-auto">
            {items.map((item) => {
              const { title, body } = text(item);
              return (
                <li key={item.id}>
                  <Link
                    href={item.link}
                    onClick={() => {
                      setOpen(false);
                      if (!item.readAt) call(markReadAction, { id: item.id });
                    }}
                    className={cn(
                      'block px-3 py-2.5 text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                      !item.readAt && 'bg-primary/5',
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      {!item.readAt && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-primary"
                          role="img"
                          aria-label={t('new')}
                        />
                      )}
                      <span className="font-medium">{title}</span>
                      {item.environment === 'TEST' && (
                        <ToneBadge tone="warning">{t('test')}</ToneBadge>
                      )}
                    </span>
                    {body && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
                    )}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {when(item.createdAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border px-3 py-2 text-center">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t('viewAll')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
