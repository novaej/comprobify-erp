import { buttonVariants } from '@comprobify/ui/components/button';
import { ThemeToggle } from '@comprobify/ui/theme';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Logomark } from '@/components/logo';
import { MarketingMobileMenu } from '@/components/marketing/marketing-mobile-menu';
import { SkipToContent } from '@/components/skip-to-content';
import { Link } from '@/i18n/navigation';
import { getRuntime } from '@/server/runtime';
import { getSession } from '@/server/session';

const NAV_LINK = 'text-muted-foreground transition-colors hover:text-foreground';

// The public pages (FR-UX-5): landing, pricing and support, with their own header and footer.
export default async function MarketingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('marketing');
  const tTheme = await getTranslations('theme');
  const signedIn = (await getSession()).status === 'active';
  const { support } = await getRuntime();

  return (
    <div className="flex min-h-screen flex-col">
      <SkipToContent />
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <Logomark className="h-7 w-7" />
              Comprobify
            </Link>
            <nav aria-label={t('nav.label')} className="hidden items-center gap-6 text-sm md:flex">
              <a href={`/${locale}#como-empezar`} className={NAV_LINK}>
                {t('nav.howToStart')}
              </a>
              <Link href="/pricing" className={NAV_LINK}>
                {t('nav.pricing')}
              </Link>
              <Link href="/support" className={NAV_LINK}>
                {t('nav.support')}
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden items-center gap-2 md:flex">
              <LocaleSwitcher />
              <ThemeToggle labels={{ toLight: tTheme('toLight'), toDark: tTheme('toDark') }} />
            </div>
            {signedIn ? (
              <Link href="/dashboard" className={buttonVariants({ size: 'sm' })}>
                {t('nav.account')}
              </Link>
            ) : (
              <>
                <Link href="/login" className={`hidden text-sm md:block ${NAV_LINK}`}>
                  {t('nav.login')}
                </Link>
                <Link href="/register" className={buttonVariants({ size: 'sm' })}>
                  {t('nav.register')}
                </Link>
              </>
            )}
            <MarketingMobileMenu />
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        {children}
      </main>

      <footer className="border-t border-border px-4 py-10 md:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-[1.6fr_repeat(3,1fr)]">
            <div className="col-span-2 md:col-span-1">
              <Link
                href="/"
                className="flex items-center gap-2 font-display text-lg font-bold tracking-tight"
              >
                <Logomark className="h-6 w-6" />
                Comprobify
              </Link>
              <p className="mt-3 max-w-xs text-sm text-muted-foreground">{t('footer.tagline')}</p>
            </div>
            <FooterColumn title={t('footer.groups.product')}>
              <a
                href={`/${locale}#como-empezar`}
                className="transition-colors hover:text-foreground"
              >
                {t('nav.howToStart')}
              </a>
              <Link href="/pricing" className="transition-colors hover:text-foreground">
                {t('nav.pricing')}
              </Link>
            </FooterColumn>
            <FooterColumn title={t('footer.groups.account')}>
              <Link href="/login" className="transition-colors hover:text-foreground">
                {t('nav.login')}
              </Link>
              <Link href="/register" className="transition-colors hover:text-foreground">
                {t('nav.register')}
              </Link>
            </FooterColumn>
            <FooterColumn title={t('footer.groups.help')}>
              <Link href="/support" className="transition-colors hover:text-foreground">
                {t('nav.support')}
              </Link>
              {support.email && (
                <a
                  href={`mailto:${support.email}`}
                  className="transition-colors hover:text-foreground"
                >
                  {t('footer.email')}
                </a>
              )}
            </FooterColumn>
          </div>
          <div className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
            © {new Date().getFullYear()} Comprobify
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-semibold text-foreground">{title}</span>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
