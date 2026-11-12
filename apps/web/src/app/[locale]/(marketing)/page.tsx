import { ArrowRight, FileSignature, ShieldCheck, Boxes } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cn } from '@comprobify/ui/lib/utils';
import { ctaVariants } from '@/components/marketing/cta-button';
import { GridBackdrop } from '@/components/marketing/grid-backdrop';
import { HeroDocument } from '@/components/marketing/hero-document';
import { LandingDocTypes } from '@/components/marketing/landing-doc-types';
import { LandingFaq } from '@/components/marketing/landing-faq';
import { LandingPlanLadder } from '@/components/marketing/landing-plan-ladder';
import { LandingSteps } from '@/components/marketing/landing-steps';
import { Link } from '@/i18n/navigation';
import { loadPublicPricing } from '@/server/public-pricing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing.seo' });
  return {
    title: { absolute: t('title') },
    description: t('description'),
    alternates: { canonical: `/${locale}` },
    openGraph: { title: t('title'), description: t('description'), type: 'website', locale },
  };
}

const TRUST_ITEMS = [
  { key: 'sri', icon: ShieldCheck },
  { key: 'signing', icon: FileSignature },
  { key: 'operations', icon: Boxes },
] as const;

// How many plans the pricing teaser shows; the pricing page lists them all.
const LADDER_SIZE = 4;

const SECTION = 'relative overflow-hidden border-t border-border px-4 py-16 md:px-8 md:py-24';

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('landing');
  const { plans } = await loadPublicPricing();

  return (
    <>
      <section className="relative overflow-hidden px-4 py-14 md:px-8 md:py-24">
        <div
          aria-hidden
          className="bg-grid mask-hero-fade pointer-events-none absolute inset-0 opacity-50"
        />
        <div
          aria-hidden
          className="animate-glow-drift pointer-events-none absolute top-1/2 right-0 h-112 w-112 -translate-y-1/2 rounded-full bg-primary/20 blur-[110px] md:right-[8%]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-primary/10 blur-[100px]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <div>
            <h1 className="font-display text-3xl leading-[1.1] font-bold tracking-tight text-balance md:text-4xl lg:text-5xl">
              {t('hero.title')}
            </h1>
            <p className="mt-5 max-w-lg text-base text-muted-foreground md:text-lg">
              {t('hero.subtitle')}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/register" className={ctaVariants()}>
                {t('hero.cta.register')}
              </Link>
              <a href="#como-empezar" className={ctaVariants('outline')}>
                {t('hero.cta.howItWorks')}
              </a>
            </div>
          </div>
          <HeroDocument />
        </div>

        <ul className="relative mx-auto mt-14 grid max-w-6xl gap-x-10 gap-y-8 md:mt-20 md:grid-cols-3">
          {TRUST_ITEMS.map(({ key, icon: Icon }) => (
            <li key={key} className="group relative border-t border-border pt-5">
              <span
                aria-hidden
                className="absolute -top-px left-0 h-px w-full origin-left scale-x-0 bg-primary transition-transform duration-300 group-hover:scale-x-100"
              />
              <Icon
                className="h-5 w-5 text-primary transition-transform duration-300 group-hover:-translate-y-0.5"
                aria-hidden
              />
              <p className="mt-3 font-medium">{t(`hero.trust.${key}.title`)}</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                {t(`hero.trust.${key}.description`)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* scroll-mt clears the sticky header when the anchor jumps. */}
      <section id="como-empezar" className={cn(SECTION, 'scroll-mt-20 bg-muted/40')}>
        <GridBackdrop side="right" />
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-12 max-w-2xl">
            <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
              {t('steps.title')}
            </h2>
            <p className="mt-3 text-muted-foreground">{t('steps.subtitle')}</p>
          </div>
          <LandingSteps />
        </div>
      </section>

      <section className={SECTION}>
        <GridBackdrop side="left" />
        <div className="relative mx-auto max-w-6xl">
          <LandingDocTypes />
        </div>
      </section>

      <section className={SECTION}>
        <GridBackdrop side="right" />
        <div className="relative mx-auto max-w-6xl">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-12">
            <div className="max-w-xl">
              <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
                {t('pricingTeaser.title')}
              </h2>
              <p className="mt-3 text-muted-foreground">{t('pricingTeaser.description')}</p>
            </div>
            <Link href="/pricing" className={cn(ctaVariants('outline'), 'shrink-0')}>
              {t('pricingTeaser.cta')}
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
            </Link>
          </div>
          <LandingPlanLadder plans={plans.slice(0, LADDER_SIZE)} />
        </div>
      </section>

      <section className={cn(SECTION, 'bg-muted/40')}>
        <GridBackdrop side="left" />
        <div className="relative mx-auto max-w-6xl">
          <LandingFaq />
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-border px-4 py-20 md:px-8 md:py-28">
        <GridBackdrop side="right" />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -bottom-40 h-120 w-120 rounded-full bg-primary/15 blur-[110px]"
        />
        <div className="relative mx-auto max-w-6xl">
          <h2 className="font-display max-w-2xl text-3xl font-bold tracking-tight text-balance md:text-4xl">
            {t('finalCta.title')}
          </h2>
          <p className="mt-4 max-w-lg text-muted-foreground">{t('finalCta.subtitle')}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/register" className={ctaVariants()}>
              {t('finalCta.register')}
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
            </Link>
            <Link href="/support" className={ctaVariants('outline')}>
              {t('finalCta.support')}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
