import { redirect } from 'next/navigation';
import { routing } from '@/i18n/routing';

// proxy.ts redirects / first; this is the fallback.
export default function RootPage() {
  redirect(`/${routing.defaultLocale}`);
}
