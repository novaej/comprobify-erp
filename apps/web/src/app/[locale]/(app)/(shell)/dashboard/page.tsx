import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { buttonVariants } from '@comprobify/ui/components/button';
import { CheckCircle2, Rocket } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { loadShell } from '@/server/shell';

// A placeholder: the dashboard's figures arrive in Milestone 9 (FR-REP-1).
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
  const t = await getTranslations('dashboard');

  return (
    <div className="max-w-3xl">
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
      <h1 className="text-2xl font-semibold tracking-tight">{active.entry.name}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{t('description')}</p>
      {!active.entry.live && actor.permissions.includes('organization.go_live') && (
        <div className="mt-6 rounded-xl border border-border bg-card p-5">
          <p className="font-medium">{t('goLiveTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('goLiveBody')}</p>
          <Link href="/go-live" className={buttonVariants({ className: 'mt-4' })}>
            {t('goLiveAction')}
          </Link>
        </div>
      )}
    </div>
  );
}
