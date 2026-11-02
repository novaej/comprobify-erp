import type { ReactNode } from 'react';
import { requireSession } from '@/server/session';
import { ActivityTracker } from './activity-tracker';

// Every page under (app) needs an active session. The sidebar shell arrives in step 5.
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
