import { listPlatformNotifications, PLATFORM_PAGE_SIZE } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHeader } from '@/components/page-header';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';
import { NotificationList } from '../../../(app)/(shell)/notifications/notification-list';

export const generateMetadata = pageTitle('adminNotifications');

// FR-NOT-2 (ADR-036): what the platform has told this super admin, newest first. Every super
// admin is told the same things; each marks their own as read.
export default async function AdminNotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; unread?: string }>;
}) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const page = Math.max(1, Number.parseInt(search.page ?? '1', 10) || 1);
  const unreadOnly = search.unread === '1';
  const list = await listPlatformNotifications(actor, db, { page, unreadOnly });
  const t = await getTranslations('notifications');
  const tAdmin = await getTranslations('adminNotifications');
  const query = (next: number) =>
    `/admin/notifications?${new URLSearchParams({
      ...(unreadOnly ? { unread: '1' } : {}),
      ...(next > 1 ? { page: String(next) } : {}),
    }).toString()}`;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={tAdmin('title')} description={tAdmin('description')} className="mb-0" />
      <section aria-labelledby="notifications-list" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="notifications-list" className="text-sm font-semibold">
            {t('listTitle')}
          </h2>
          <nav aria-label={t('filter.label')} className="flex gap-2">
            <Link
              href="/admin/notifications"
              aria-current={unreadOnly ? undefined : 'page'}
              className={buttonVariants({
                size: 'sm',
                variant: unreadOnly ? 'outline' : 'default',
              })}
            >
              {t('filter.all')}
            </Link>
            <Link
              href="/admin/notifications?unread=1"
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
          scope="platform"
          unreadOnly={unreadOnly}
          items={list.items.map((item) => ({
            ...item,
            environment: 'PRODUCTION' as const,
            createdAt: item.createdAt.toISOString(),
            readAt: item.readAt?.toISOString() ?? null,
          }))}
        />
        {(page > 1 || list.hasMore) && (
          <nav
            aria-label={t('pagination.label')}
            className="flex items-center justify-between gap-3 text-sm"
          >
            {page > 1 ? (
              <Link href={query(page - 1)} className="underline-offset-4 hover:underline">
                {t('pagination.previous')}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground">
              {t('pagination.page', { page, size: PLATFORM_PAGE_SIZE })}
            </span>
            {list.hasMore ? (
              <Link href={query(page + 1)} className="underline-offset-4 hover:underline">
                {t('pagination.next')}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
