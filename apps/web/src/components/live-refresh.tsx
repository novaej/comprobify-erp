'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';

// While something runs in the background, the page reads itself again every few seconds, but
// not while the tab is hidden. Refreshing isn't activity, so it never keeps an idle session
// alive (the tracker records only what the user does, FR-USR-2).
export function LiveRefresh({ active, everyMs = 5_000 }: { active: boolean; everyMs?: number }) {
  const t = useTranslations('liveRefresh');
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs, router]);
  if (!active) return null;
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden />
      {t('updating')}
    </p>
  );
}
