import type { ReactNode } from 'react';
import { requireSession } from '@/server/session';
import { ActivityTracker } from './activity-tracker';

// Every page under (app) needs an active session; the sidebar shell is in (shell).
export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireSession(locale);
  return (
    <>
      <ActivityTracker />
      {children}
    </>
  );
}
