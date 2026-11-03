import type { ReactNode } from 'react';
import { AdminNav } from '@/components/shell/admin-nav';
import { TopBar } from '@/components/shell/top-bar';
import { SkipToContent } from '@/components/skip-to-content';
import { loadPlatform } from '@/server/platform';
import { ActivityTracker } from '../../(app)/activity-tracker';

// ADR-010: platform work, outside any company. Its own sidebar, no switcher, no tenant.
export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session } = await loadPlatform(locale);

  return (
    <>
      <SkipToContent />
      <ActivityTracker />
      <div className="flex h-screen flex-col overflow-hidden md:flex-row">
        <AdminNav user={{ name: session.user.name, email: session.user.email }} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopBar />
          <main
            id="main-content"
            tabIndex={-1}
            className="relative flex-1 overflow-y-auto p-4 outline-none md:p-8"
          >
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
