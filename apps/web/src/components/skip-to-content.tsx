import { getTranslations } from 'next-intl/server';

// The first tab stop: lets keyboard users jump past the navigation (WCAG 2.4.1).
export async function SkipToContent() {
  const t = await getTranslations('nav');
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
    >
      {t('skipToContent')}
    </a>
  );
}
