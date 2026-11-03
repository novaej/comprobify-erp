import { getCatalog } from '@comprobify/core';
import { getTranslations, setRequestLocale } from 'next-intl/server';
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
import { ToneBadge } from '@/components/tone-badge';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';
import { NewModuleButton } from '../catalog-manager';
import { STATUS_TONE } from '../catalog-tones';

export const generateMetadata = pageTitle('adminModules');

// FR-ADM-3: the units that are sold, and the feature keys in each.
export default async function AdminModulesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const catalog = await getCatalog(actor, db);
  const t = await getTranslations('catalog');
  const english = locale === 'en';

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('modulesPageTitle')}
        description={t('modulesPageDescription')}
        action={<NewModuleButton />}
      />
      <TableCard>
        <StackTable aria-label={t('modulesPageTitle')}>
          <StackHeader>
            <StackRow className="bg-muted/40">
              <StackHead className="pl-4">{t('table.module')}</StackHead>
              <StackHead>{t('table.features')}</StackHead>
              <StackHead className="pr-4">{t('table.status')}</StackHead>
            </StackRow>
          </StackHeader>
          <StackBody>
            {catalog.modules.map((module) => (
              <StackRow key={module.key}>
                <StackCell heading className="pl-4">
                  <Link
                    href={`/admin/modules/${module.key}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {english ? module.nameEn : module.nameEs}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">{module.key}</p>
                </StackCell>
                <StackCell label={t('table.features')} className="whitespace-normal">
                  <span className="font-mono text-xs text-muted-foreground">
                    {module.features
                      .filter((feature) => !feature.removesAt)
                      .map((feature) => feature.key)
                      .join(', ')}
                  </span>
                </StackCell>
                <StackCell label={t('table.status')} className="pr-4">
                  <span className="flex flex-wrap gap-1.5">
                    <ToneBadge tone={STATUS_TONE[module.status] ?? 'neutral'}>
                      {t(`statuses.${module.status}`)}
                    </ToneBadge>
                    {module.isBase && <ToneBadge tone="primary">{t('base')}</ToneBadge>}
                  </span>
                </StackCell>
              </StackRow>
            ))}
          </StackBody>
        </StackTable>
      </TableCard>
    </div>
  );
}
