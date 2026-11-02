import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { OnboardingForm } from './onboarding-form';

export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('onboarding');
  const tNav = await getTranslations('nav');

  return (
    <main id="main-content" className="mx-auto w-full max-w-2xl p-4 py-10 md:p-8">
      {/* Before the first organization there is no shell, so the account is linked here. */}
      <div className="mb-6 flex justify-end">
        <Link
          href="/account"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {tNav('account')}
        </Link>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-1.5 mb-8 text-sm text-muted-foreground">{t('description')}</p>
      <OnboardingForm />
    </main>
  );
}
