import { ThemeToggle } from '@comprobify/ui/theme';
import { Check } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from './locale-switcher';
import { LogoLockup, LogoLockupStacked } from './logo';

const TRUST_KEYS = ['sri', 'signing', 'operations'] as const;

// Faint grid in the panel's accent color, so it reads on the light and dark panel.
const PANEL_GRID = {
  backgroundImage:
    'linear-gradient(to right, color-mix(in oklab, var(--panel-accent) 12%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--panel-accent) 12%, transparent) 1px, transparent 1px)',
  backgroundSize: '56px 56px',
  maskImage: 'radial-gradient(ellipse 80% 70% at 30% 35%, black 25%, transparent 75%)',
} as const;

// The public auth screens: a brand panel on wide screens, the form column on every screen.
export async function AuthShell({
  title,
  description,
  topLeft,
  children,
}: {
  title: string;
  description?: string;
  topLeft?: ReactNode;
  children: ReactNode;
}) {
  const locale = await getLocale();
  const t = await getTranslations('auth.panel');
  const tTheme = await getTranslations('theme');

  return (
    <div className="grid min-h-screen lg:grid-cols-[5fr_6fr]">
      {/* The panel borrows the sidebar token names with the panel's own colors. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground [--sidebar-foreground:var(--panel-foreground)] [--sidebar-muted:var(--panel-muted)] [--sidebar-primary:var(--panel-accent)] [--sidebar:var(--panel)] lg:flex">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={PANEL_GRID} />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -bottom-32 h-112 w-112 rounded-full bg-sidebar-primary/15 blur-[110px]"
        />
        <a href={`/${locale}`} className="relative w-fit">
          <LogoLockup className="h-8 w-auto" />
        </a>
        <div className="relative max-w-md">
          <p className="font-display text-4xl leading-[1.1] font-bold tracking-tight text-balance">
            {t('title')}
          </p>
          <p className="mt-5 text-sidebar-foreground/70">{t('subtitle')}</p>
          <ul className="mt-8 flex flex-col gap-3 text-sm">
            {TRUST_KEYS.map((key) => (
              <li key={key} className="flex items-center gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/20 text-sidebar-primary">
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                </span>
                {t(`trust.${key}`)}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-sidebar-muted">
          © {new Date().getFullYear()} Comprobify
        </p>
      </aside>

      <div className="flex min-h-screen flex-col bg-background">
        <div className="flex items-center justify-between gap-2 px-6 py-5">
          <div>{topLeft}</div>
          <div className="flex items-center gap-2">
            <ThemeToggle labels={{ toLight: tTheme('toLight'), toDark: tTheme('toDark') }} />
            <LocaleSwitcher />
          </div>
        </div>

        <main id="main-content" className="flex flex-1 items-center justify-center p-4 pb-12">
          <div className="w-full max-w-sm">
            <div className="mb-7 text-center lg:text-left">
              <a href={`/${locale}`} className="mb-6 inline-block lg:hidden">
                <LogoLockupStacked variant="light" className="mx-auto w-40 dark:hidden" />
                <LogoLockupStacked variant="dark" className="mx-auto hidden w-40 dark:block" />
              </a>
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function AuthCard({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-6 shadow-sm">{children}</div>;
}

export function Notice({
  tone = 'muted',
  children,
}: {
  tone?: 'muted' | 'error' | 'success';
  children: ReactNode;
}) {
  const tones = {
    muted: 'border-border bg-muted/40 text-muted-foreground',
    error: 'border-destructive/30 bg-destructive/5 text-destructive',
    success: 'border-success-border bg-success-soft text-success',
  };
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mb-4 rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
