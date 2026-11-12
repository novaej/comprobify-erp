'use client';

import { Menu, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ThemeToggle } from '@comprobify/ui/theme';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Link } from '@/i18n/navigation';

const ITEM = 'rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-accent';

// The header's links are hidden on a phone; this sheet holds the same ones plus sign-in,
// language and theme.
export function MarketingMobileMenu() {
  const t = useTranslations('marketing');
  const tTheme = useTranslations('theme');
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  // The page behind must not scroll while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('nav.openMenu')}
        className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="fixed inset-x-0 top-0 z-50 flex flex-col gap-1 border-b border-border bg-background p-4 shadow-lg md:hidden">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">{t('nav.menu')}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('nav.closeMenu')}
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <a href={`/${locale}#como-empezar`} onClick={() => setOpen(false)} className={ITEM}>
              {t('nav.howToStart')}
            </a>
            <Link href="/pricing" onClick={() => setOpen(false)} className={ITEM}>
              {t('nav.pricing')}
            </Link>
            <Link href="/support" onClick={() => setOpen(false)} className={ITEM}>
              {t('nav.support')}
            </Link>
            <Link href="/login" onClick={() => setOpen(false)} className={ITEM}>
              {t('nav.login')}
            </Link>
            <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
              <LocaleSwitcher />
              <ThemeToggle labels={{ toLight: tTheme('toLight'), toDark: tTheme('toDark') }} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
