import { ThemeToggle } from '@comprobify/ui/theme';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { LogoLockup } from '@/components/logo';
import { SkipToContent } from '@/components/skip-to-content';
import { Link } from '@/i18n/navigation';
import { loadPlatform } from '@/server/platform';
import { ActivityTracker } from '../../(app)/activity-tracker';

// ADR-010: platform work, outside any company. No switcher, no tenant context.
export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await loadPlatform(locale);
  const t = await getTranslations('admin');
  const tTheme = await getTranslations('theme');

  return (
    <>
      <SkipToContent />
      <ActivityTracker />
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href="/admin" className="flex items-center gap-2">
            <LogoLockup className="h-7 w-auto" />
          </Link>
          <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
            {t('badge')}
          </span>
          <nav aria-label={t('navigation')} className="ml-auto flex items-center gap-3 text-sm">
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
              {t('backToApp')}
            </Link>
            <LocaleSwitcher />
            <ThemeToggle labels={{ toLight: tTheme('toLight'), toDark: tTheme('toDark') }} />
          </nav>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl p-4 outline-none md:p-8">
        {children}
      </main>
    </>
  );
}
