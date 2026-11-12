import { cn } from '@comprobify/ui/lib/utils';
import { buttonVariants } from '@comprobify/ui/components/button';
import {
  ChevronDown,
  CreditCard,
  FileKey,
  FlaskConical,
  Layers,
  ListOrdered,
  BellRing,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

const QUESTIONS = [
  { key: 'certificate', icon: FileKey },
  { key: 'testing', icon: FlaskConical },
  { key: 'payment', icon: CreditCard },
  { key: 'sequentials', icon: ListOrdered },
  { key: 'modules', icon: Layers },
  { key: 'authorization', icon: BellRing },
] as const;

// Native <details>: keyboard accessible and crawlable with no JavaScript. The same `name`
// makes the browser close the others when one opens.
export async function LandingFaq() {
  const t = await getTranslations('landing.faq');
  const locale = await getLocale();

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
      <div className="lg:sticky lg:top-28 lg:self-start">
        <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">{t('title')}</h2>
        <p className="mt-3 max-w-sm text-muted-foreground">{t('subtitle')}</p>
        <div className="mt-8 max-w-sm border-t border-border pt-6">
          <p className="font-medium">{t('moreTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('moreText')}</p>
          <a
            href={`/${locale}/support`}
            className={cn(buttonVariants({ variant: 'outline' }), 'mt-4 h-10 px-4')}
          >
            {t('moreLink')}
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {QUESTIONS.map(({ key, icon: Icon }, i) => (
          <details
            key={key}
            name="landing-faq"
            open={i === 0}
            className="group rounded-xl border border-border bg-card px-5 shadow-sm transition-colors open:border-primary/40 hover:border-primary/30"
          >
            <summary className="flex cursor-pointer list-none items-center gap-4 py-4 text-left font-medium [&::-webkit-details-marker]:hidden">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-open:bg-primary group-open:text-primary-foreground">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="flex-1">{t(`${key}.question`)}</span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <p className="pb-5 pl-13 text-sm leading-relaxed text-muted-foreground">
              {t(`${key}.answer`)}
            </p>
          </details>
        ))}
      </div>
    </div>
  );
}
