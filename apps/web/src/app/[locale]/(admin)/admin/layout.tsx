import { platformNotificationSummary } from '@comprobify/core';
import type { ReactNode } from 'react';
import { AdminNav } from '@/components/shell/admin-nav';
import { TopBar } from '@/components/shell/top-bar';
import { SkipToContent } from '@/components/skip-to-content';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';
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
  const { session, actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  // FR-NOT-2: the platform bell, read with the page.
  const summary = await platformNotificationSummary(actor, db);
  // One element per place it is shown (the mobile bar and the top bar), never one instance twice.
  const bell = () => (
    <NotificationBell
      scope="platform"
      unread={summary.unread}
      items={summary.items.map((item) => ({
        ...item,
        environment: 'PRODUCTION' as const,
        createdAt: item.createdAt.toISOString(),
        readAt: item.readAt?.toISOString() ?? null,
      }))}
    />
  );

  return (
    <>
      <SkipToContent />
      <ActivityTracker />
      <div className="flex h-screen flex-col overflow-hidden md:flex-row">
        <AdminNav user={{ name: session.user.name, email: session.user.email }} bell={bell()} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopBar bell={bell()} />
          <main
            id="main-content"
            // In the tab order, as in the app: it scrolls, so a keyboard must be able to reach it.
            tabIndex={0}
            className="relative flex-1 overflow-y-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:p-8"
          >
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
