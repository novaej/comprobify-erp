'use client';

import { useRouter } from '@/i18n/navigation';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

// While SRI hasn't answered, the page refreshes itself: quickly at first, as most answers
// come within seconds, then every half minute. Refreshing isn't activity, so it never
// keeps an idle session alive (the tracker records only what the user does).
const DELAYS = [2_000, 3_000, 5_000, 10_000, 15_000];
const AFTER = 30_000;

export function LiveStatus({ waiting }: { waiting: boolean }) {
  const t = useTranslations('documents.detail');
  const router = useRouter();
  useEffect(() => {
    if (!waiting) return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(() => {
        // Not while the tab is hidden: nobody is looking.
        if (document.visibilityState === 'visible') router.refresh();
        attempt += 1;
        next();
      }, DELAYS[attempt] ?? AFTER);
    };
    next();
    return () => clearTimeout(timer);
  }, [waiting, router]);
  if (!waiting) return null;
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden />
      {t('waiting')}
    </p>
  );
}
