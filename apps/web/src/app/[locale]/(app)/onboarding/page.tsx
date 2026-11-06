import { TAX_REGIMES } from '@comprobify/core';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StandaloneShell } from '@/components/standalone-shell';
import { Link } from '@/i18n/navigation';
import { OnboardingForm } from './onboarding-form';
import { pageTitle } from '@/server/page-title';

export const generateMetadata = pageTitle('onboarding');

export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('onboarding');
  const tNav = await getTranslations('nav');
  const tSettings = await getTranslations('settings');
  const regimes = TAX_REGIMES.map((regime) => ({
    value: regime,
    label: tSettings(`regimes.${regime}`),
  }));

  // Before the first company there is no shell, so the account is linked here.
  return (
    <StandaloneShell
      title={t('title')}
      description={t('description')}
      width="lg"
      topLeft={
        <Link href="/account" className="text-sm text-muted-foreground hover:text-foreground">
          {tNav('account')}
        </Link>
      }
    >
      <OnboardingForm regimes={regimes} />
    </StandaloneShell>
  );
}
