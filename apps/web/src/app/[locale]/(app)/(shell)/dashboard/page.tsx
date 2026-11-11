import { dashboard, hasFeature, type DocumentStatus } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { cn } from '@comprobify/ui/lib/utils';
import { CheckCircle2, Rocket } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { PageHeader } from '@/components/page-header';
import { ProgressBar } from '@/components/progress-bar';
import { SectionCard } from '@/components/section-card';
import {
  StackBody,
  StackCell,
  StackHead,
  StackHeader,
  StackRow,
  StackTable,
  TableCard,
} from '@/components/stack-table';
import { ToneBadge, type Tone } from '@/components/tone-badge';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { STATUS_TONE } from '../documents/document-status';

export const generateMetadata = pageTitle('dashboard');

// Waiting on SRI or on being sent, and what needs a person (FR-REP-1 highlights both).
const PENDING: DocumentStatus[] = ['SIGNED', 'PENDING_SEND', 'RECEIVED'];
const FAILED: DocumentStatus[] = ['RETURNED', 'SEND_FAILED', 'NOT_AUTHORIZED'];
const CERTIFICATE_TONE: Record<'ok' | 'expiring' | 'expired' | 'missing', Tone> = {
  ok: 'success',
  expiring: 'warning',
  expired: 'danger',
  missing: 'danger',
};

// FR-REP-1: sales, documents by status, quota, top products, stock and the certificate. A part
// shows only what the person's role and plan reach; the go-live prompt stays for the owner.
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ welcome?: string; live?: string }>;
}) {
  const [{ locale }, { welcome, live }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { active, actor } = await loadShell(locale);
  const { db } = await getRuntime();
  const t = await getTranslations('dashboard');
  const tDocs = await getTranslations('documents');
  const figures =
    actor.permissions.includes('reports.read') && hasFeature(actor, 'REPORTS_BASIC')
      ? await dashboard(actor, db)
      : null;
  const money = new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
  });
  const amount = (value: string) => money.format(value as Intl.StringNumericLiteral);
  const quantity = (value: string) =>
    new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', { maximumFractionDigits: 2 }).format(
      Number(value),
    );
  const date = (value: Date) =>
    new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
      dateStyle: 'long',
      timeZone: 'America/Guayaquil',
    }).format(value);
  const total = (statuses: DocumentStatus[]) =>
    statuses.reduce((sum, status) => sum + (figures?.documents?.[status] ?? 0), 0);
  const pending = total(PENDING);
  const failed = total(FAILED);

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        {welcome && (
          <Banner tone="success" icon={CheckCircle2} role="note" title={t('welcomeTitle')}>
            {t('welcomeBody')}
          </Banner>
        )}
        {live && (
          <Banner tone="success" icon={Rocket} role="note" title={t('liveTitle')}>
            {t('liveBody')}
          </Banner>
        )}
        <PageHeader title={active.entry.name} description={t('description')} className="mb-0" />
      </div>
      {!active.entry.live && actor.permissions.includes('organization.go_live') && (
        <SectionCard
          title={t('goLiveTitle')}
          description={t('goLiveBody')}
          action={
            <Link href="/go-live" className={buttonVariants({ size: 'sm' })}>
              <Rocket className="mr-1.5 h-4 w-4" aria-hidden />
              {t('goLiveAction')}
            </Link>
          }
        />
      )}

      {figures?.sales && (
        <section aria-labelledby="dashboard-figures">
          <h2 id="dashboard-figures" className="sr-only">
            {t('figures')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <li className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">{t('salesToday')}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">
                {amount(figures.sales.today.total)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('invoices', { count: figures.sales.today.count })}
              </p>
            </li>
            <li className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">{t('salesMonth')}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">
                {amount(figures.sales.month.total)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('invoices', { count: figures.sales.month.count })}
              </p>
            </li>
            <li>
              <Link
                href="/documents/pending"
                className="block h-full rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
              >
                <ToneBadge tone="info">{t('pending')}</ToneBadge>
                <p className="mt-2 text-xl font-semibold tabular-nums">{pending}</p>
                <p className="text-xs text-muted-foreground">{t('pendingHint')}</p>
              </Link>
            </li>
            <li>
              <Link
                href="/documents/pending"
                className={cn(
                  'block h-full rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40',
                  failed > 0 ? 'border-destructive' : 'border-border',
                )}
              >
                <ToneBadge tone={failed > 0 ? 'danger' : 'neutral'}>{t('failed')}</ToneBadge>
                <p className="mt-2 text-xl font-semibold tabular-nums">{failed}</p>
                <p className="text-xs text-muted-foreground">{t('failedHint')}</p>
              </Link>
            </li>
          </ul>
        </section>
      )}

      {figures && (
        <div className="grid gap-6 lg:grid-cols-2">
          {figures.documents && (
            <SectionCard title={t('byStatus')} description={t('byStatusHint')}>
              <ul className="divide-y divide-border">
                {(Object.keys(figures.documents) as DocumentStatus[]).map((status) => (
                  <li key={status} className="flex items-center justify-between gap-3 py-2">
                    <Link
                      href={{ pathname: '/documents', query: { status } }}
                      className="underline-offset-4 hover:underline"
                    >
                      <ToneBadge tone={STATUS_TONE[status]}>
                        {tDocs(`statuses.${status}`)}
                      </ToneBadge>
                    </Link>
                    <span className="text-sm font-medium tabular-nums">
                      {figures.documents![status]}
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {figures.topProducts && (
            <SectionCard title={t('topProducts')} description={t('topProductsHint')}>
              {figures.topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('topProductsEmpty')}</p>
              ) : (
                <TableCard className="mt-1">
                  <StackTable aria-label={t('topProducts')}>
                    <StackHeader>
                      <StackRow className="bg-muted/40">
                        <StackHead className="pl-4">{t('product')}</StackHead>
                        <StackHead className="text-right">{t('quantity')}</StackHead>
                        <StackHead className="text-right">{t('sold')}</StackHead>
                      </StackRow>
                    </StackHeader>
                    <StackBody>
                      {figures.topProducts.map((row) => (
                        <StackRow key={`${row.code}-${row.name}`}>
                          <StackCell heading className="pl-4">
                            {row.name}
                          </StackCell>
                          <StackCell label={t('quantity')} className="text-right tabular-nums">
                            {quantity(row.quantity)}
                          </StackCell>
                          <StackCell label={t('sold')} className="text-right tabular-nums">
                            {amount(row.base)}
                          </StackCell>
                        </StackRow>
                      ))}
                    </StackBody>
                  </StackTable>
                </TableCard>
              )}
            </SectionCard>
          )}

          {figures.lowStock && (
            <SectionCard
              title={t('lowStock')}
              description={t('lowStockHint')}
              action={
                <Link
                  href="/inventory"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  {t('seeInventory')}
                </Link>
              }
            >
              {figures.lowStock.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('lowStockEmpty')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {figures.lowStock.map((row) => (
                    <li key={row.code} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 truncate text-sm">{row.name}</span>
                      <span className="text-sm font-medium tabular-nums">
                        {quantity(row.available)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}

          {figures.quota && (
            <SectionCard
              title={t('quota')}
              description={t('quotaHint')}
              action={
                <Link href="/plan" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  {t('seePlan')}
                </Link>
              }
            >
              {figures.quota.limit === null ? (
                <p className="text-sm">{t('quotaUnlimited', { used: figures.quota.used })}</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm tabular-nums">
                    {t('quotaUsed', { used: figures.quota.used, limit: figures.quota.limit })}
                  </p>
                  <ProgressBar
                    label={t('quota')}
                    total={figures.quota.limit}
                    done={Math.min(figures.quota.used, figures.quota.limit)}
                  />
                </div>
              )}
              {figures.quota.packs > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('quotaPacks', { count: figures.quota.packs })}
                </p>
              )}
            </SectionCard>
          )}

          <SectionCard
            title={t('certificate')}
            description={t('certificateHint')}
            action={
              actor.permissions.includes('organization.manage') ? (
                <Link
                  href="/settings"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  {t('seeSettings')}
                </Link>
              ) : undefined
            }
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ToneBadge tone={CERTIFICATE_TONE[figures.certificate.state]}>
                {t(`certificateState.${figures.certificate.state}`)}
              </ToneBadge>
              {figures.certificate.state !== 'missing' && (
                <span className="text-muted-foreground">
                  {t(
                    figures.certificate.state === 'expired'
                      ? 'certificateEnded'
                      : 'certificateEnds',
                    { date: date(figures.certificate.notAfter) },
                  )}
                </span>
              )}
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
