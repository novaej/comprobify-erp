'use client';

import { Button, buttonVariants } from '@comprobify/ui/components/button';
import * as Sentry from '@sentry/nextjs';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Link } from '@/i18n/navigation';

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errorBoundary');
  const tCommon = useTranslations('common');
  const tApiError = useTranslations('apiError');

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" />
      <h2 className="text-xl font-semibold">{t('title')}</h2>
      {/* Next.js strips custom error fields on the way to the client, so this stays generic. */}
      <p className="max-w-md text-sm text-muted-foreground">{tApiError('UNKNOWN')}</p>
      <div className="flex gap-3">
        <Button onClick={reset}>{tCommon('retry')}</Button>
        <Link href="/" className={buttonVariants({ variant: 'outline' })}>
          {t('backToDashboard')}
        </Link>
      </div>
    </div>
  );
}
