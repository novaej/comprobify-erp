'use client';

import { cn } from '@comprobify/ui/lib/utils';
import { ThemeToggle } from '@comprobify/ui/theme';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ScrollText,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useSyncExternalStore, type ComponentType } from 'react';
import { signOutAction } from '@/app/[locale]/(app)/actions';
import { Link, usePathname } from '@/i18n/navigation';
import { LocaleSwitcher } from '../locale-switcher';
import { Logomark, LogoLockup } from '../logo';
import { OrgSwitcher, type SwitcherOrganization } from './org-switcher';

type NavItem = {
  href: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  labelKey: 'dashboard' | 'users' | 'activity' | 'plan' | 'legal';
  group: 'operate' | 'manage';
  // Core still enforces both; these only hide the link (FR-ROLE-3, FR-PLAN-4).
  permission: string | null;
  feature?: string;
};

// Modules add their entries as they arrive.
const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    icon: LayoutDashboard,
    labelKey: 'dashboard',
    group: 'operate',
    permission: null,
  },
  {
    href: '/users',
    icon: UsersRound,
    labelKey: 'users',
    group: 'manage',
    permission: 'users.read',
  },
  {
    href: '/audit',
    icon: ScrollText,
    labelKey: 'activity',
    group: 'manage',
    permission: 'audit.read',
  },
  {
    href: '/plan',
    icon: Package,
    labelKey: 'plan',
    group: 'manage',
    permission: 'billing.read',
  },
  { href: '/legal', icon: FileText, labelKey: 'legal', group: 'manage', permission: null },
];

const COLLAPSED_KEY = 'nav-collapsed';
const collapseListeners = new Set<() => void>();

// The preference lives in localStorage, read through useSyncExternalStore so the
// server and the first client render agree (expanded) without an effect.
const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
};
const writeCollapsed = (value: boolean) => {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(value));
  } catch {
    // Storage blocked: the choice is lost on reload.
  }
  collapseListeners.forEach((listener) => listener());
};
const subscribeCollapsed = (listener: () => void) => {
  collapseListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    collapseListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
};

export type NavProps = {
  organizations: SwitcherOrganization[];
  activeRealTenantId: string;
  mode: 'TEST' | 'PRODUCTION';
  permissions: readonly string[];
  features: readonly string[];
  user: { name: string; email: string; roleLabel: string };
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

export function Nav({
  organizations,
  activeRealTenantId,
  mode,
  permissions,
  features,
  user,
}: NavProps) {
  const t = useTranslations('nav');
  const tTheme = useTranslations('theme');
  const locale = useLocale();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const [hovered, setHovered] = useState(false);
  const expanded = !collapsed || hovered;
  const items = NAV_ITEMS.filter(
    (item) =>
      (!item.permission || permissions.includes(item.permission)) &&
      (!item.feature || features.includes(item.feature)),
  );
  const themeLabels = { toLight: tTheme('toLight'), toDark: tTheme('toDark') };

  const toggleCollapsed = () => {
    if (collapsed) setHovered(false);
    writeCollapsed(!collapsed);
  };

  const switcher = (
    <OrgSwitcher
      organizations={organizations}
      activeRealTenantId={activeRealTenantId}
      mode={mode}
    />
  );

  const links = (showLabels: boolean, onNavigate?: () => void) => (
    <div className="flex flex-col gap-4">
      {(['operate', 'manage'] as const)
        .map((group) => ({ group, entries: items.filter((item) => item.group === group) }))
        .filter(({ entries }) => entries.length > 0)
        .map(({ group, entries }) => (
          <div key={group}>
            {showLabels && (
              <p className="mb-1 px-3 text-2xs font-medium text-sidebar-muted">
                {t(`groups.${group}`)}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {entries.map(({ href, icon: Icon, labelKey }) => {
                const active = pathname.startsWith(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      title={showLabels ? undefined : t(labelKey)}
                      aria-current={active ? 'page' : undefined}
                      onClick={onNavigate}
                      className={cn(
                        'flex items-center rounded-md transition-colors',
                        showLabels ? 'gap-2.5 px-3 py-2 text-sm' : 'justify-center py-2.5',
                        active
                          ? 'bg-sidebar-active font-medium text-sidebar-active-foreground shadow-sm'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {showLabels && <span className="truncate">{t(labelKey)}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
    </div>
  );

  const footer = (showLabels: boolean) => (
    <div className={cn('flex items-center gap-2', !showLabels && 'flex-col')}>
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/20 text-xs font-semibold text-sidebar-primary select-none"
        title={showLabels ? undefined : user.name}
        aria-hidden
      >
        {initialsOf(user.name) || user.email.slice(0, 2).toUpperCase()}
      </div>
      {showLabels && (
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-sidebar-foreground">{user.name}</p>
          <span className="mt-0.5 inline-flex items-center rounded bg-sidebar-primary/15 px-1.5 py-0.5 text-2xs leading-none font-medium text-sidebar-primary">
            {user.roleLabel}
          </span>
        </div>
      )}
      <Link
        href="/account"
        title={t('account')}
        aria-label={t('account')}
        className="rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <UserRound className="h-4 w-4" aria-hidden />
      </Link>
      <form action={signOutAction}>
        <input type="hidden" name="locale" value={locale} />
        <button
          type="submit"
          title={t('signOut')}
          aria-label={t('signOut')}
          className="rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label={t('openMenu')}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <Logomark className="h-6 w-6 shrink-0" />
      </div>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Mobile drawer */}
      <nav
        aria-label={t('mainNavigation')}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label={t('closeMenu')}
            className="rounded-md p-1 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
          <LogoLockup className="h-7 w-auto" />
        </div>
        <div className="border-b border-sidebar-border px-4 py-3">{switcher}</div>
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {links(true, () => setMobileOpen(false))}
        </div>
        <div className="space-y-3 border-t border-sidebar-border px-3 py-3">
          {footer(true)}
          <div className="flex items-center justify-between px-1">
            <LocaleSwitcher />
            <ThemeToggle labels={themeLabels} />
          </div>
        </div>
      </nav>

      {/* Desktop sidebar: the outer div holds the space; the nav overlays on hover-expand. */}
      <div
        className={cn(
          'relative hidden shrink-0 transition-[width] duration-200 md:block',
          collapsed ? 'w-14' : 'w-64',
        )}
      >
        <nav
          aria-label={t('mainNavigation')}
          onMouseEnter={() => collapsed && setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className={cn(
            'absolute inset-y-0 left-0 flex flex-col overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-200',
            collapsed && hovered ? 'z-50 w-64 shadow-2xl' : collapsed ? 'w-14' : 'w-64',
          )}
        >
          <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-3">
            {expanded ? (
              <>
                <LogoLockup className="h-7 w-auto min-w-0 flex-1" />
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  title={collapsed ? t('lockSidebar') : t('collapseSidebar')}
                  aria-label={collapsed ? t('lockSidebar') : t('collapseSidebar')}
                  className="ml-2 shrink-0 rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  {collapsed ? (
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  ) : (
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </>
            ) : (
              <div className="flex w-full justify-center">
                <Logomark className="h-7 w-7" />
              </div>
            )}
          </div>
          {expanded ? (
            <div className="border-b border-sidebar-border px-4 py-3">{switcher}</div>
          ) : (
            <div className="flex justify-center border-b border-sidebar-border py-3">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  mode === 'PRODUCTION' ? 'bg-success' : 'bg-warning',
                )}
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-2 py-3">{links(expanded)}</div>
          <div className="border-t border-sidebar-border px-3 py-3">{footer(expanded)}</div>
        </nav>
      </div>
    </>
  );
}
