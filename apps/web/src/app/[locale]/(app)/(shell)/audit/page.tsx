import { auditCategoryOf, listAuditEvents, type AuditCategory } from '@comprobify/core';
import { cn } from '@comprobify/ui/lib/utils';
import { ScrollText } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { Link } from '@/i18n/navigation';
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
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { pageTitle } from '@/server/page-title';

export const generateMetadata = pageTitle('activity');

// FR-NOT-4: who did what, when, in this company. Times in Ecuador (CLAUDE.md rule 15). Two
// categories share the log (ADR-041): the account and its setup, and what the business did.
export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string; mine?: string }>;
}) {
  const [{ locale }, { category: requested, mine: mineRequested }] = await Promise.all([
    params,
    searchParams,
  ]);
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  const allowed: AuditCategory[] = [
    ...(actor.permissions.includes('audit.read') ? (['ACCOUNT'] as const) : []),
    ...(actor.permissions.includes('audit.operations.read') ? (['OPERATIONS'] as const) : []),
  ];
  // Without either permission: only what the person did themselves (ADR-041).
  const ownOnly = allowed.length === 0;
  const mine = ownOnly || mineRequested === '1';
  // One category at a time when only one is allowed; "everything" is the default for both.
  const category = allowed.find((value) => value === requested);

  const { db } = await getRuntime();
  const events = await listAuditEvents(actor, db, { limit: 200, category, mine });
  const t = await getTranslations('audit');
  const tRoles = await getTranslations('roles');
  const tSri = await getTranslations('sri');
  const english = locale === 'en';
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Guayaquil',
  });
  const text = (value: unknown) =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : '';

  // The account side: only these detail fields are shown; anything else stays in the database.
  const accountDetail = (details: Record<string, unknown>) => {
    if (typeof details.email === 'string') return details.email;
    if (typeof details.role === 'string') return tRoles(details.role as 'VIEWER');
    if (Array.isArray(details.points))
      return details.points.length ? details.points.join(', ') : t('allPoints');
    if (typeof details.required === 'boolean') return details.required ? t('on') : t('off');
    if (typeof details.issuerName === 'string') return details.issuerName;
    if (typeof details.point === 'string') return details.point;
    if (typeof details.branch === 'string')
      return typeof details.name === 'string'
        ? `${details.branch} ${details.name}`
        : details.branch;
    if (Array.isArray(details.sequences)) return details.sequences.join(', ');
    // Names were stored with the change, so a later rename doesn't rewrite history.
    if (typeof details.planEs === 'string')
      return String(english ? details.planEn : details.planEs);
    if (typeof details.moduleEs === 'string')
      return String(english ? details.moduleEn : details.moduleEs);
    if (typeof details.billing === 'string')
      return details.billing === 'COMPLIMENTARY' ? t('complimentary') : t('paid');
    if (typeof details.feature === 'string') return details.feature;
    if (typeof details.monthlyPrice === 'string') return `$${details.monthlyPrice}`;
    if ('monthlyPrice' in details) return '—';
    return '';
  };

  // The operations side: what the thing was, and what is worth saying about the act. Values
  // were stored as the person typed or the system computed them, never in a language.
  const field = (name: string) =>
    t.has(`fieldNames.${name}`) ? t(`fieldNames.${name}` as 'fieldNames.code') : name;
  const operationDetail = (action: string, details: Record<string, unknown>) => {
    const parts: string[] = [];
    if (typeof details.label === 'string') parts.push(details.label);
    if (action === 'stock.adjusted') {
      parts.push(
        `${details.direction === 'OUT' ? t('detail.out') : t('detail.in')} ${text(details.quantity)}`,
      );
      if (typeof details.reason === 'string') parts.push(details.reason);
    } else if (action === 'stock.opening_set') {
      parts.push(`${text(details.quantity)} × $${text(details.unitCost)}`);
    } else if (action === 'stock.opening_imported') {
      parts.push(t('detail.balances', { count: Number(details.count ?? 0) }));
    } else if (action.endsWith('.imported')) {
      parts.push(
        t('detail.counts', {
          created: Number(details.created ?? 0),
          updated: Number(details.updated ?? 0),
        }),
      );
    } else if (action.endsWith('.active_changed')) {
      parts.push(details.active ? t('detail.activated') : t('detail.deactivated'));
    } else if (action === 'purchase_order.cancelled' || action === 'sale_order.cancelled') {
      if (typeof details.reason === 'string') parts.push(details.reason);
    } else if (action === 'sale_order.invoiced') {
      parts.push(t('detail.invoice', { number: text(details.invoice) }));
    } else if (action === 'receivable.payment_recorded') {
      parts.push(`$${text(details.amount)}`);
      if (typeof details.method === 'string')
        parts.push(tSri(`paymentMethods.${details.method as '01'}`));
    } else if (action === 'receivable.payment_voided') {
      parts.push(`$${text(details.amount)}`);
      if (typeof details.reason === 'string') parts.push(details.reason);
    } else if (action === 'bulk.batch_started') {
      parts.push(
        `${t('detail.invoices', { count: Number(details.count ?? 0) })} ${
          details.source === 'CSV' ? t('detail.fromCsv') : t('detail.fromOrders')
        }`,
      );
    } else if (action === 'data.exported') {
      const key = text(details.export);
      const [kind, name] = key.split(':');
      parts.push(
        kind && t.has(`exports.${kind}`)
          ? `${t(`exports.${kind}` as 'exports.clients')}${name ? ` ${name}` : ''}`
          : key,
      );
    }
    // A product's price or tax, before and after; a client's data, which fields only.
    const changes = details.changes;
    if (changes && typeof changes === 'object')
      for (const [name, value] of Object.entries(changes as Record<string, unknown>)) {
        const [before, after] = Array.isArray(value) ? (value as unknown[]) : [];
        parts.push(
          `${field(name)} ${t('detail.by', { from: text(before) || t('detail.none'), to: text(after) || t('detail.none') })}`,
        );
      }
    if (Array.isArray(details.fields) && details.fields.length > 0)
      parts.push(
        t('detail.changed', {
          fields: details.fields.map((name) => field(String(name))).join(', '),
        }),
      );
    return parts.join(' · ');
  };

  const tabs: { value: AuditCategory | undefined; label: string }[] = [
    ...(allowed.length > 1 ? [{ value: undefined, label: t('categories.ALL') }] : []),
    ...allowed.map((value) => ({ value, label: t(`categories.${value}`) })),
  ];
  const shown = category ?? (allowed.length === 1 ? allowed[0] : undefined);
  const description = ownOnly
    ? t('descriptionOwn')
    : shown === 'OPERATIONS'
      ? t('descriptionOperations')
      : shown === 'ACCOUNT'
        ? t('descriptionAccount')
        : t('description');

  return (
    <div className="max-w-5xl">
      <PageHeader title={t('title')} description={description} />
      {!ownOnly && (
        <nav aria-label={t('whoseLabel')} className="mb-2 flex flex-wrap gap-1">
          {[false, true].map((own) => (
            <Link
              key={String(own)}
              href={{
                pathname: '/audit',
                query: { ...(category ? { category } : {}), ...(own ? { mine: '1' } : {}) },
              }}
              aria-current={own === mine ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                own === mine
                  ? 'bg-primary font-medium text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {own ? t('whoseMine') : t('whoseAll')}
            </Link>
          ))}
        </nav>
      )}
      {tabs.length > 1 && (
        <nav aria-label={t('categoriesLabel')} className="mb-4 flex flex-wrap gap-1">
          {tabs.map((tab) => {
            const active = tab.value === category;
            return (
              <Link
                key={tab.value ?? 'all'}
                href={{
                  pathname: '/audit',
                  query: {
                    ...(tab.value ? { category: tab.value } : {}),
                    ...(mine ? { mine: '1' } : {}),
                  },
                }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}
      <TableCard>
        {events.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={shown === 'OPERATIONS' ? t('emptyOperations') : t('empty')}
            description={shown === 'OPERATIONS' ? undefined : t('emptyHint')}
          />
        ) : (
          <StackTable aria-label={t('title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.what')}</StackHead>
                <StackHead className="pr-4 text-right">{t('table.when')}</StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {events.map((event) => {
                const detail =
                  auditCategoryOf(event.action) === 'OPERATIONS'
                    ? operationDetail(event.action, event.details)
                    : accountDetail(event.details);
                return (
                  <StackRow key={event.id}>
                    <StackCell heading className="pl-4 whitespace-normal">
                      <span className="font-medium">{event.actorName ?? t('system')}</span>{' '}
                      {t(`actions.${event.action}`)}
                      {event.subjectName && (
                        <span className="font-medium"> {event.subjectName}</span>
                      )}
                      {detail && <span className="text-muted-foreground">: {detail}</span>}
                    </StackCell>
                    <StackCell
                      label={t('table.when')}
                      className="pr-4 text-right whitespace-nowrap text-muted-foreground"
                    >
                      <time dateTime={event.occurredAt.toISOString()}>
                        {when.format(event.occurredAt)}
                      </time>
                    </StackCell>
                  </StackRow>
                );
              })}
            </StackBody>
          </StackTable>
        )}
      </TableCard>
    </div>
  );
}
