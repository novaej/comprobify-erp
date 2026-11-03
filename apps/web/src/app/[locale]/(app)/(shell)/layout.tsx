import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';

export default async function ShellLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <AppShell locale={locale}>{children}</AppShell>;
}
