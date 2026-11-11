import {
  ACTIVITY_GROUPS,
  ACTIVITY_PAGE_SIZE,
  activityCounts,
  platformActivity,
  type ActivityGroup,
} from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { ScrollText } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import {
  StackBody,
  StackCell,
  StackHead,
  StackHeader,
  StackRow,
  StackTable,
  TableCard,
} from '@/components/stack-table';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';

export const generateMetadata = pageTitle('adminActivity');

// What a detail says: a date where it is one, else the text, cut so a long value can't take a row.
const show = (value: unknown, format: Intl.DateTimeFormat) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value))
    return format.format(new Date(value));
  return String(value).slice(0, 80);
};

// The platform's own log: what the super admins changed that reaches every company. Newest first,
// by group.
export default async function AdminActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ group?: string; page?: string }>;
}) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const group = (ACTIVITY_GROUPS as readonly string[]).includes(search.group ?? '')
    ? (search.group as ActivityGroup)
    : undefined;
  const page = Math.max(1, Number.parseInt(search.page ?? '1', 10) || 1);
  const [list, counts] = await Promise.all([
    platformActivity(actor, db, { page, group }),
    activityCounts(actor, db),
  ]);
  const t = await getTranslations('adminActivity');
  const tz = locale === 'en' ? 'en' : 'es-EC';
  const when = new Intl.DateTimeFormat(tz, {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });
  const day = new Intl.DateTimeFormat(tz, { dateStyle: 'medium', timeZone: 'America/Guayaquil' });
  const query = (next: number) => ({
    pathname: '/admin/activity' as const,
    query: { ...(group ? { group } : {}), ...(next > 1 ? { page: String(next) } : {}) },
  });

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('title')} description={t('description')} className="mb-2" />
      <nav aria-label={t('filter')} className="flex flex-wrap gap-2">
        <Link
          href="/admin/activity"
          aria-current={group ? undefined : 'page'}
          className={buttonVariants({ size: 'sm', variant: group ? 'outline' : 'default' })}
        >
          {t('all')}
        </Link>
        {ACTIVITY_GROUPS.map((item) => (
          <Link
            key={item}
            href={{ pathname: '/admin/activity', query: { group: item } }}
            aria-current={group === item ? 'page' : undefined}
            className={buttonVariants({
              size: 'sm',
              variant: group === item ? 'default' : 'outline',
            })}
          >
            {t(`groups.${item}`)} ({counts[item]})
          </Link>
        ))}
      </nav>
      <TableCard>
        {list.rows.length === 0 ? (
          <EmptyState icon={ScrollText} title={t('emptyTitle')} description={t('empty')} />
        ) : (
          <StackTable aria-label={t('title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.when')}</StackHead>
                <StackHead>{t('table.who')}</StackHead>
                <StackHead className="pr-4">{t('table.what')}</StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {list.rows.map((row) => (
                <StackRow key={row.id}>
                  <StackCell heading className="pl-4 tabular-nums">
                    {when.format(row.occurredAt)}
                  </StackCell>
                  <StackCell label={t('table.who')}>
                    {row.actorName}
                    <span className="block text-xs break-all text-muted-foreground">
                      {row.actorEmail}
                    </span>
                  </StackCell>
                  <StackCell label={t('table.what')} className="pr-4">
                    {t.has(`actions.${row.action.replace('.', '_')}` as 'actions.job_retried')
                      ? t(`actions.${row.action.replace('.', '_')}` as 'actions.job_retried')
                      : row.action}
                    <dl className="mt-1 flex min-w-0 flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      {Object.entries(row.details)
                        .filter(([, value]) => value !== null && value !== '')
                        .map(([name, value]) => (
                          <div key={name} className="flex gap-1">
                            <dt>{name}:</dt>
                            <dd className="break-all text-foreground">{show(value, day)}</dd>
                          </div>
                        ))}
                    </dl>
                  </StackCell>
                </StackRow>
              ))}
            </StackBody>
          </StackTable>
        )}
      </TableCard>
      {(page > 1 || list.hasMore) && (
        <nav
          aria-label={t('pagination.label')}
          className="flex items-center justify-between text-sm"
        >
          {page > 1 ? (
            <Link href={query(page - 1)} className="underline-offset-4 hover:underline">
              {t('pagination.previous')}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            {t('pagination.page', { page, size: ACTIVITY_PAGE_SIZE })}
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
    </div>
  );
}
