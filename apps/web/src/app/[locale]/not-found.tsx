import { buttonVariants } from '@comprobify/ui/components/button';
import { FileSearch2 } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

export default async function LocaleNotFound() {
  const t = await getTranslations('notFoundPage');
  const locale = await getLocale();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
      <p className="select-none text-[9rem] font-black leading-none tracking-tight text-foreground/[0.04]">
        404
      </p>
      <div className="-mt-8 mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-muted ring-4 ring-background">
        <FileSearch2 className="h-7 w-7 text-muted-foreground" />
      </div>
      <h2 className="mb-2 text-xl font-semibold">{t('title')}</h2>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">{t('description')}</p>
      {/* A full navigation: soft navigation away from notFound() can no-op (Next.js #49736). */}
      <a href={`/${locale}`} className={buttonVariants()}>
        {t('backToDashboard')}
      </a>
    </div>
  );
}
