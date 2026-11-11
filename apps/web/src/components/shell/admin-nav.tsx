'use client';

import { cn } from '@comprobify/ui/lib/utils';
import { ThemeToggle } from '@comprobify/ui/theme';
import {
  ArrowLeftRight,
  Banknote,
  Bell,
  Blocks,
  Cog,
  CreditCard,
  Building2,
  ListOrdered,
  Mail,
  LogOut,
  Package,
  ReceiptText,
  Menu,
  ShieldCheck,
  Tag,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { signOutAction } from '@/app/[locale]/(app)/actions';
import { Link, usePathname } from '@/i18n/navigation';
import { LocaleSwitcher } from '../locale-switcher';
import { Logomark, LogoLockup } from '../logo';

type AdminItem = {
  href: string;
  icon: LucideIcon;
  labelKey:
    | 'companies'
    | 'queue'
    | 'jobs'
    | 'payments'
    | 'invoicing'
    | 'cards'
    | 'notifications'
    | 'plans'
    | 'modules'
    | 'prices'
    | 'emails';
  // The pages under it; /admin itself is the companies list.
  section: string;
};

// Platform work, grouped like the app's sidebar (ADR-010).
const GROUPS: { group: 'operate' | 'catalog'; items: AdminItem[] }[] = [
  {
    group: 'operate',
    items: [
      { href: '/admin', icon: Building2, labelKey: 'companies', section: '/admin/companies' },
      { href: '/admin/queue', icon: ListOrdered, labelKey: 'queue', section: '/admin/queue' },
      { href: '/admin/jobs', icon: Cog, labelKey: 'jobs', section: '/admin/jobs' },
      { href: '/admin/payments', icon: Banknote, labelKey: 'payments', section: '/admin/payments' },
      {
        href: '/admin/invoicing',
        icon: ReceiptText,
        labelKey: 'invoicing',
        section: '/admin/invoicing',
      },
      { href: '/admin/cards', icon: CreditCard, labelKey: 'cards', section: '/admin/cards' },
      {
        href: '/admin/notifications',
        icon: Bell,
        labelKey: 'notifications',
        section: '/admin/notifications',
      },
    ],
  },
  {
    group: 'catalog',
    items: [
      { href: '/admin/plans', icon: Package, labelKey: 'plans', section: '/admin/plans' },
      { href: '/admin/modules', icon: Blocks, labelKey: 'modules', section: '/admin/modules' },
      { href: '/admin/prices', icon: Tag, labelKey: 'prices', section: '/admin/prices' },
      { href: '/admin/emails', icon: Mail, labelKey: 'emails', section: '/admin/emails' },
    ],
  },
];

// The platform's sidebar: the same look as the app's, without a company or switcher.
export function AdminNav({
  user,
  bell,
}: {
  user: { name: string; email: string };
  // The platform bell, shown in the mobile bar; desktop has it in the top bar.
  bell?: ReactNode;
}) {
  const t = useTranslations('adminNav');
  const tNav = useTranslations('nav');
  const tTheme = useTranslations('theme');
  const locale = useLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const initials =
    user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || user.email.slice(0, 2).toUpperCase();

  const body = (
    <>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="flex flex-col gap-4">
          {GROUPS.map(({ group, items }) => (
            <div key={group}>
              <p className="mb-1 px-3 text-2xs font-medium text-sidebar-muted">
                {t(`groups.${group}`)}
              </p>
              <ul className="flex flex-col gap-0.5">
                {items.map(({ href, icon: Icon, labelKey, section }) => {
                  const active = pathname === href || pathname.startsWith(section);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                          active
                            ? 'bg-sidebar-active font-medium text-sidebar-active-foreground shadow-sm'
                            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="truncate">{t(labelKey)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 border-t border-sidebar-border px-3 py-3">
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground select-none"
            aria-hidden
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-sidebar-foreground" title={user.email}>
              {user.name}
            </p>
            <span className="mt-0.5 inline-flex items-center rounded bg-sidebar-primary/15 px-1.5 py-0.5 text-2xs leading-none font-medium text-sidebar-foreground">
              {t('badge')}
            </span>
          </div>
          <Link
            href="/dashboard"
            title={t('backToApp')}
            aria-label={t('backToApp')}
            className="rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden />
          </Link>
          <form action={signOutAction}>
            <input type="hidden" name="locale" value={locale} />
            <button
              type="submit"
              title={tNav('signOut')}
              aria-label={tNav('signOut')}
              className="rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </form>
        </div>
        {/* Language and theme sit in the top bar on desktop; here only on phones. */}
        <div className="flex items-center justify-between px-1 md:hidden">
          <LocaleSwitcher />
          <ThemeToggle labels={{ toLight: tTheme('toLight'), toDark: tTheme('toDark') }} />
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={tNav('openMenu')}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <Logomark className="h-6 w-6 shrink-0" />
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {t('title')}
        </span>
        {bell && <div className="ml-auto">{bell}</div>}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <nav
        aria-label={t('navigation')}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200',
          'md:relative md:inset-auto md:z-auto md:translate-x-0 md:transition-none',
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-sidebar-border px-4">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={tNav('closeMenu')}
            className="rounded-md p-1 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:hidden"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
          <LogoLockup className="h-7 w-auto min-w-0 flex-1" />
          <span className="flex items-center gap-1 rounded bg-warning-soft px-1.5 py-0.5 text-2xs font-medium text-warning">
            <ShieldCheck className="h-3 w-3" aria-hidden />
            {t('badge')}
          </span>
        </div>
        {body}
      </nav>
    </>
  );
}
