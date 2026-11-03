import 'server-only';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

// WCAG 2.4.2: every page names itself, so tabs, history and screen readers tell them apart.
// The root layout adds " · Comprobify".
export const pageTitle =
  (key: string) =>
  async ({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> => {
    const { locale } = await params;
    const t = await getTranslations({ locale, namespace: 'pageTitles' });
    return { title: t(key) };
  };
