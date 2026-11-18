import { listNotifications, notificationPreferences } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ListPager } from '@/components/list-pager';
import { PageHeader } from '@/components/page-header';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { NotificationList } from './notification-list';
import { Preferences } from './preferences';

export const generateMetadata = pageTitle('notifications');

// FR-NOT-1: everything the company has told the member, newest first, and what they choose to
// receive. Each member sees only their own.
export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ after?: string; before?: string; unread?: string }>;
}) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  const unreadOnly = search.unread === '1';
  const [list, preferences] = await Promise.all([
    listNotifications(actor, db, { after: search.after, before: search.before, unreadOnly }),
    notificationPreferences(actor, db),
  ]);
  const t = await getTranslations('notifications');
  const pageHref = (cursor: { after?: string; before?: string }) => ({
    pathname: '/notifications' as const,
    query: { ...(unreadOnly ? { unread: '1' } : {}), ...cursor },
  });

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={t('title')} description={t('description')} className="mb-0" />

      <section aria-labelledby="notifications-list" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="notifications-list" className="text-sm font-semibold">
            {t('listTitle')}
          </h2>
          <nav aria-label={t('filter.label')} className="flex gap-2">
            <Link
              href="/notifications"
              aria-current={unreadOnly ? undefined : 'page'}
              className={buttonVariants({
                size: 'sm',
                variant: unreadOnly ? 'outline' : 'default',
              })}
            >
              {t('filter.all')}
            </Link>
            <Link
              href="/notifications?unread=1"
              aria-current={unreadOnly ? 'page' : undefined}
              className={buttonVariants({
                size: 'sm',
                variant: unreadOnly ? 'default' : 'outline',
              })}
            >
              {t('filter.unread')}
            </Link>
          </nav>
        </div>
        <NotificationList
          unreadOnly={unreadOnly}
          items={list.items.map((item) => ({
            ...item,
            createdAt: item.createdAt.toISOString(),
            readAt: item.readAt?.toISOString() ?? null,
          }))}
        />
        <ListPager
          label={t('pagination.label')}
          previous={list.previous ? pageHref({ before: list.previous }) : null}
          next={list.next ? pageHref({ after: list.next }) : null}
        />
      </section>

      <Preferences
        rows={preferences.map((row) => ({
          type: row.type,
          mandatory: row.mandatory,
          channels: row.channels,
        }))}
      />
    </div>
  );
}
