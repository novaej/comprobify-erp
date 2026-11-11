import { ecuadorDate, hasFeature, type Permission } from '@comprobify/core';
import { AlertCircle, BarChart3, ChevronRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { FeatureLocked } from '@/components/feature-locked';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { loadShell } from '@/server/shell';
import { AccountantExport } from './accountant-export';

export const generateMetadata = pageTitle('reports');

// FR-REP-2: where the reports start. Each links to a screen with its range; a person sees only
// the reports their role and plan reach.
export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ problem?: string; month?: string }>;
}) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'REPORTS_BASIC')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('reports.read')) return <NoAccess />;
  const t = await getTranslations('reports');
  const can = (permission: Permission) => actor.permissions.includes(permission);

  const entries = [
    { key: 'sales', href: '/reports/sales', shown: can('documents.read') },
    { key: 'documents', href: '/reports/documents', shown: can('documents.read') },
    { key: 'taxes', href: '/reports/taxes', shown: can('documents.read') },
    {
      key: 'aging',
      href: '/receivables',
      shown: can('sales.read') && hasFeature(actor, 'RECEIVABLES'),
    },
    {
      key: 'movements',
      href: '/reports/movements',
      shown: can('inventory.read') && hasFeature(actor, 'INVENTORY'),
    },
    {
      key: 'purchases',
      href: '/reports/purchases',
      shown: can('purchasing.read') && hasFeature(actor, 'PURCHASE_ORDERS'),
    },
    {
      key: 'valuation',
      href: '/inventory/valuation',
      shown: can('inventory.read') && hasFeature(actor, 'INVENTORY'),
    },
  ].filter((entry) => entry.shown);

  return (
    <div className="max-w-4xl">
      <PageHeader title={t('title')} description={t('description')} />
      {(search.problem === 'EXPORT_EMPTY' || search.problem === 'EXPORT_TOO_LARGE') && (
        <Banner tone="warning" icon={AlertCircle}>
          {t(`accountant.${search.problem}`, { month: search.month ?? '' })}
        </Banner>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {entries.map(({ key, href }) => (
          <li key={key}>
            <Link
              href={href}
              className="flex h-full items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
            >
              <BarChart3 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  {t(`reports.${key}.name` as 'reports.sales.name')}
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  {t(`reports.${key}.description` as 'reports.sales.description')}
                </span>
              </span>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {can('reports.export') && can('documents.read') && (
        <AccountantExport month={ecuadorDate(new Date()).slice(0, 7)} />
      )}
    </div>
  );
}
