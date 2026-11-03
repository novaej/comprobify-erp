import { chooseActiveOrganization, listOrganizations } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { Building2 } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Notice } from '@/components/auth-shell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { AppShell } from '@/components/shell/app-shell';
import { StandaloneShell } from '@/components/standalone-shell';
import { ToneBadge } from '@/components/tone-badge';
import { Link } from '@/i18n/navigation';
import { getRuntime } from '@/server/runtime';
import { requireSession } from '@/server/session';
import { Sessions } from './sessions';
import { TwoFactorSettings } from './two-factor';
import { pageTitle } from '@/server/page-title';

export const generateMetadata = pageTitle('account');

// The user's own account: their companies, two-step verification and sessions. Inside
// the app shell when there is a company to work in; on its own before one exists, or
// while the company requires a TOTP the user hasn't set up (the shell would send them here).
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ twoFactorRequired?: string }>;
}) {
  const [{ locale }, { twoFactorRequired }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const session = await requireSession(locale);
  const { db } = await getRuntime();
  const organizations = await listOrganizations(db, session.user.id);
  // The same rule as the shell, so both show the same active organization.
  const active = chooseActiveOrganization(organizations, session.activeTenantId);
  const t = await getTranslations('account');
  const tSecurity = await getTranslations('security');
  const inShell =
    active !== null && !(active.entry.requireTwoFactor && !session.user.twoFactorEnabled);

  const sections = (
    <div className="space-y-4">
      <SectionCard
        title={t('organizations')}
        action={
          organizations.length > 0 ? undefined : (
            <Link href="/onboarding" className={buttonVariants({ size: 'sm' })}>
              {t('setUpCompany')}
            </Link>
          )
        }
      >
        {organizations.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={t('noCompanyTitle')}
            description={t('noCompanyDescription')}
            className="py-6"
          />
        ) : (
          <ul className="divide-y divide-border" aria-label={t('organizations')}>
            {organizations.map((organization) => (
              <li
                key={organization.realTenantId}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm first:pt-0 last:pb-0"
              >
                <span className="min-w-0">
                  <span className="block font-medium">{organization.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {organization.ruc}
                  </span>
                </span>
                {active?.tenantId === organization.twinTenantId && (
                  <ToneBadge tone="warning">{t('activeTest')}</ToneBadge>
                )}
                {active?.tenantId === organization.realTenantId && (
                  <ToneBadge tone="success">{t('activeProduction')}</ToneBadge>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title={tSecurity('title')} description={tSecurity('description')}>
        {twoFactorRequired && !session.user.twoFactorEnabled && (
          <Notice tone="error">
            {tSecurity(
              twoFactorRequired === 'admin' ? 'requiredByPlatform' : 'requiredByOrganization',
            )}
          </Notice>
        )}
        <TwoFactorSettings enabled={session.user.twoFactorEnabled} />
      </SectionCard>
      <SectionCard title={t('sessionsTitle')} description={t('sessionsDescription')}>
        <Sessions />
      </SectionCard>
    </div>
  );

  if (!inShell)
    return (
      <StandaloneShell title={t('title')} description={session.user.email} width="lg">
        {sections}
      </StandaloneShell>
    );
  return (
    <AppShell locale={locale}>
      <Page title={t('title')} email={session.user.email}>
        {sections}
      </Page>
    </AppShell>
  );
}

function Page({ title, email, children }: { title: string; email: string; children: ReactNode }) {
  return (
    <div className="max-w-3xl">
      <PageHeader title={title} description={email} />
      {children}
    </div>
  );
}
