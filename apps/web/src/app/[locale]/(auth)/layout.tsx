import type { ReactNode } from 'react';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/server/session';

// Signed-in users have nothing to do on these screens.
export default async function AuthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if ((await getSession()).status === 'active') redirect({ href: '/dashboard', locale });
  return children;
}
