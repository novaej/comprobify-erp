import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PricingPlans } from '@/components/marketing/pricing-plans';
import { loadPublicPricing } from '@/server/public-pricing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pricing.seo' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: `/${locale}/pricing` },
    openGraph: { title: t('title'), description: t('description'), type: 'website', locale },
  };
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pricing');
  const pricing = await loadPublicPricing();

  return (
    <div className="px-4 py-12 md:px-8 md:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            {t('title')}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground md:text-lg">
            {t('subtitle')}
          </p>
        </div>
        <PricingPlans pricing={pricing} />
      </div>
    </div>
  );
}
