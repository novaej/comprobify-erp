import { Mail, MessageCircle } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { getRuntime } from '@/server/runtime';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'support' });
  return { title: t('title'), description: t('description') };
}

const CARD =
  'flex items-start gap-3 rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/40';

// Contact details only (FR-UX-5): nothing to sign in for, nothing to fill in.
export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('support');
  const { support } = await getRuntime();

  return (
    <div className="px-4 py-12 md:px-8 md:py-20">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">{t('title')}</h1>
        <p className="mt-4 text-base text-muted-foreground md:text-lg">{t('description')}</p>

        <div className="mt-10">
          {!support.email && !support.phone ? (
            <div className="rounded-xl border border-border bg-card">
              <EmptyState icon={Mail} title={t('noContact')} />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {support.email && (
                <a href={`mailto:${support.email}`} className={CARD}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Mail className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t('emailLabel')}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">
                      {t('emailDescription')}
                    </span>
                    <span className="mt-2 block text-sm font-medium break-all text-primary">
                      {support.email}
                    </span>
                  </span>
                </a>
              )}
              {support.phone && (
                <a
                  href={`https://wa.me/${support.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={CARD}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <MessageCircle className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t('phoneLabel')}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">
                      {t('phoneDescription')}
                    </span>
                    <span className="mt-2 block text-sm font-medium text-primary">
                      {support.phone}
                    </span>
                  </span>
                </a>
              )}
            </div>
          )}
        </div>
        <p className="mt-8 text-sm text-muted-foreground">{t('hours')}</p>
      </div>
    </div>
  );
}
