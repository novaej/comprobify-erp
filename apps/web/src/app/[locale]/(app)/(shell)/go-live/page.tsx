import { companySettings } from '@comprobify/core';
import { CheckCircle2, FlaskConical, Hash, Lock } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { GoLiveForm } from './form';
import { pageTitle } from '@/server/page-title';

export const generateMetadata = pageTitle('goLive');

const POINTS = [
  { key: 'point1', icon: CheckCircle2 },
  { key: 'point2', icon: FlaskConical },
  { key: 'point3', icon: Lock },
  { key: 'point4', icon: Hash },
] as const;

// FR-ONB-5: one-way, so the page says exactly what changes before asking.
export default async function GoLivePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor, active } = await loadShell(locale);
  if (!actor.permissions.includes('organization.go_live')) return <NoAccess />;
  const t = await getTranslations('goLive');
  const tNav = await getTranslations('nav');
  const tSri = await getTranslations('sri');
  // FR-ONB-5: one starting number per issue point and document type it issues.
  const { db } = await getRuntime();
  const settings = active.entry.live ? null : await companySettings(actor, db);
  const points = (settings?.branches ?? []).flatMap((branch) =>
    branch.issuePoints.flatMap((point) =>
      point.documentTypes.map((type) => ({
        key: `${branch.code}-${point.code}-${type}`,
        label: `${branch.code}-${point.code} · ${tSri(`documentTypes.${type as '01'}`)}`,
      })),
    ),
  );

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={t('title', { organization: active.entry.name })}
        description={t('description')}
        backHref="/dashboard"
        backLabel={tNav('dashboard')}
      />
      <SectionCard title={t('whatChanges')}>
        {active.entry.live ? (
          <p className="text-sm">{t('alreadyLive')}</p>
        ) : (
          <>
            <ul className="space-y-3 text-sm">
              {POINTS.map(({ key, icon: Icon }) => (
                <li key={key} className="flex gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  {t(key)}
                </li>
              ))}
            </ul>
            <GoLiveForm points={points} />
          </>
        )}
      </SectionCard>
    </div>
  );
}
