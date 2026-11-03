'use client';

import { Button } from '@comprobify/ui/components/button';
import { LogOut } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { signOutAction, signOutEverywhereAction } from '../actions';

// Signing out everywhere ends every other device's session too, so it asks first.
export function Sessions() {
  const t = useTranslations('account');
  const locale = useLocale();
  const everywhere = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-wrap gap-3">
      <form action={signOutAction}>
        <input type="hidden" name="locale" value={locale} />
        <Button type="submit" variant="outline">
          <LogOut className="mr-1.5 h-4 w-4" aria-hidden />
          {t('signOut')}
        </Button>
      </form>
      <form ref={everywhere} action={signOutEverywhereAction}>
        <input type="hidden" name="locale" value={locale} />
        <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
          {t('signOutEverywhere')}
        </Button>
      </form>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('signOutEverywhereTitle')}
        description={t('signOutEverywhereDescription')}
        confirmLabel={t('signOutEverywhere')}
        destructive
        onConfirm={() => everywhere.current?.requestSubmit()}
      />
    </div>
  );
}
