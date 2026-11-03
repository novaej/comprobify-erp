'use client';

import { cn } from '@comprobify/ui/lib/utils';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { switchOrganizationAction } from '@/app/[locale]/(app)/(shell)/actions';
import { useRouter } from '@/i18n/navigation';

export type SwitcherOrganization = {
  realTenantId: string;
  twinTenantId: string | null;
  name: string;
  ruc: string;
  live: boolean;
};

// FR-USR-5: one entry per organization, and a Producción / Pruebas toggle for the active one.
export function OrgSwitcher({
  organizations,
  activeRealTenantId,
  mode,
}: {
  organizations: SwitcherOrganization[];
  activeRealTenantId: string;
  mode: 'TEST' | 'PRODUCTION';
}) {
  const t = useTranslations('nav');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const active = organizations.find(
    (organization) => organization.realTenantId === activeRealTenantId,
  );

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const switchTo = (tenantId: string | null) => {
    if (!tenantId) return;
    setOpen(false);
    startTransition(async () => {
      await switchOrganizationAction(tenantId);
      router.refresh();
    });
  };
  // An organization opens in production once live, in its test copy before (FR-ONB-5).
  const defaultTenant = (organization: SwitcherOrganization) =>
    organization.live
      ? organization.realTenantId
      : (organization.twinTenantId ?? organization.realTenantId);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 rounded-md text-left disabled:opacity-50"
      >
        <span className="min-w-0">
          <span className="block truncate text-xs leading-none font-semibold text-sidebar-foreground">
            {active?.name}
          </span>
          <span
            className={cn(
              'mt-1 inline-flex items-center rounded px-1.5 py-0.5 text-2xs leading-none font-medium',
              mode === 'PRODUCTION'
                ? 'bg-success-soft text-success'
                : 'bg-warning-soft text-warning',
            )}
          >
            {mode === 'PRODUCTION' ? t('productionBadge') : t('testBadge')}
          </span>
          {/* After the visible text, so the accessible name starts with what is seen. */}
          <span className="sr-only">, {t('switchOrganization')}</span>
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-sidebar-muted transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {active && (
        <div
          role="group"
          aria-label={t('environment')}
          className="mt-2 grid grid-cols-2 rounded-md border border-sidebar-border p-0.5 text-2xs"
        >
          <button
            type="button"
            aria-pressed={mode === 'PRODUCTION'}
            disabled={pending || !active.live}
            title={active.live ? undefined : t('productionAfterGoLive')}
            onClick={() => switchTo(active.realTenantId)}
            className={cn(
              'rounded px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              mode === 'PRODUCTION'
                ? 'bg-sidebar-active font-medium text-sidebar-active-foreground'
                : 'text-sidebar-foreground/70',
            )}
          >
            {t('production')}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'TEST'}
            disabled={pending || !active.twinTenantId}
            onClick={() => switchTo(active.twinTenantId)}
            className={cn(
              'rounded px-2 py-1 transition-colors',
              mode === 'TEST'
                ? 'bg-sidebar-active font-medium text-sidebar-active-foreground'
                : 'text-sidebar-foreground/70',
            )}
          >
            {t('test')}
          </button>
        </div>
      )}

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-50 mt-1 max-h-72 w-full min-w-56 overflow-y-auto rounded-lg border border-sidebar-border bg-sidebar p-1 shadow-lg"
        >
          {organizations.map((organization) => {
            const current = organization.realTenantId === activeRealTenantId;
            return (
              <button
                key={organization.realTenantId}
                type="button"
                role="menuitem"
                aria-current={current ? 'true' : undefined}
                onClick={() => (current ? setOpen(false) : switchTo(defaultTenant(organization)))}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors',
                  current
                    ? 'bg-sidebar-active font-medium text-sidebar-active-foreground'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
              >
                <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{organization.name}</span>
                  <span className="block font-mono text-2xs opacity-70">{organization.ruc}</span>
                </span>
                {current && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
