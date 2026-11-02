import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { CheckCircle2 } from 'lucide-react';
import { loadShell } from '@/server/shell';

// A placeholder: the dashboard's figures arrive in Milestone 9 (FR-REP-1).
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ welcome?: string }>;
}) {
  const [{ locale }, { welcome }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { active } = await loadShell(locale);
  const t = await getTranslations('dashboard');

  return (
    <div className="max-w-3xl">
      {welcome && (
        <Banner tone="success" icon={CheckCircle2} role="note" title={t('welcomeTitle')}>
          {t('welcomeBody')}
        </Banner>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">{active.entry.name}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{t('description')}</p>
    </div>
  );
}
