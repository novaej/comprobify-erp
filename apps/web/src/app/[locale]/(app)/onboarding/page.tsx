import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OnboardingForm } from './onboarding-form';

export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('onboarding');

  return (
    <div className="mx-auto w-full max-w-2xl p-4 py-10 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-1.5 mb-8 text-sm text-muted-foreground">{t('description')}</p>
      <OnboardingForm />
    </div>
  );
}
