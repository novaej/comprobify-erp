import { ThemeToggle } from '@comprobify/ui/theme';
import { cn } from '@comprobify/ui/lib/utils';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from './locale-switcher';
import { LogoLockupStacked } from './logo';

const WIDTHS = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' } as const;

// Full-screen pages outside the sidebar, such as an account with no company yet:
// a quiet background, the stacked logo, a title, and the page's own cards below.
export async function StandaloneShell({
  title,
  description,
  topLeft,
  width = 'md',
  children,
}: {
  title?: string;
  description?: string;
  // A back link or a sign-out form.
  topLeft?: ReactNode;
  width?: keyof typeof WIDTHS;
  children: ReactNode;
}) {
  const tTheme = await getTranslations('theme');
  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <div className="flex items-center justify-between gap-2 px-6 py-5">
        <div>{topLeft}</div>
        <div className="flex items-center gap-2">
          <ThemeToggle labels={{ toLight: tTheme('toLight'), toDark: tTheme('toDark') }} />
          <LocaleSwitcher />
        </div>
      </div>
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 items-start justify-center p-4 outline-none"
      >
        <div className={cn('w-full', WIDTHS[width])}>
          <div className="mb-8 flex flex-col items-center gap-4 text-center">
            <LogoLockupStacked variant="light" className="h-14 w-auto dark:hidden" />
            <LogoLockupStacked variant="dark" className="hidden h-14 w-auto dark:block" />
            {title && (
              <div>
                <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
                {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
              </div>
            )}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
