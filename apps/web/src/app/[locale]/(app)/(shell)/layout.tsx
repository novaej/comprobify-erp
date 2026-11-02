import { AlertCircle, AlertTriangle, FlaskConical } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Banner } from '@/components/banner';
import { Nav } from '@/components/shell/nav';
import { TopBar } from '@/components/shell/top-bar';
import { SkipToContent } from '@/components/skip-to-content';
import { loadShell } from '@/server/shell';

// FR-UX-2: the sidebar layout, the sandbox banner and the certificate banner.
export default async function ShellLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, organizations, active, actor, certificate } = await loadShell(locale);
  const t = await getTranslations('shell');
  const tRoles = await getTranslations('roles');

  return (
    <>
      <SkipToContent />
      <div className="flex h-screen flex-col overflow-hidden md:flex-row">
        <Nav
          organizations={organizations.map(({ realTenantId, twinTenantId, name, ruc, live }) => ({
            realTenantId,
            twinTenantId,
            name,
            ruc,
            live,
          }))}
          activeRealTenantId={active.entry.realTenantId}
          mode={active.mode}
          permissions={actor.permissions}
          user={{
            name: session.user.name,
            email: session.user.email,
            roleLabel: tRoles(active.entry.role),
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopBar />
          <main
            id="main-content"
            tabIndex={-1}
            className="relative flex-1 overflow-y-auto p-4 outline-none md:p-8"
          >
            {active.mode === 'TEST' && (
              <Banner tone="warning" icon={FlaskConical} role="note" title={t('sandboxTitle')}>
                {t('sandboxBody')}
              </Banner>
            )}
            {certificate.state === 'expired' && (
              <Banner tone="danger" icon={AlertCircle} title={t('certificateExpiredTitle')}>
                {t('certificateExpiredBody')}
              </Banner>
            )}
            {certificate.state === 'expiring' && (
              <Banner
                tone="warning"
                icon={AlertTriangle}
                title={t('certificateExpiringTitle', { days: certificate.daysLeft })}
              >
                {t('certificateExpiringBody')}
              </Banner>
            )}
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
