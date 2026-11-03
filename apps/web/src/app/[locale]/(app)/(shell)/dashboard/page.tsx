import { buttonVariants } from '@comprobify/ui/components/button';
import { CheckCircle2, Rocket } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { Link } from '@/i18n/navigation';
import { loadShell } from '@/server/shell';
import { pageTitle } from '@/server/page-title';

export const generateMetadata = pageTitle('dashboard');

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
      <PageHeader title={active.entry.name} description={t('description')} />
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
    </div>
  );
}
