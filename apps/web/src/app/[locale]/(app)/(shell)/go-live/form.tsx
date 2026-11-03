'use client';

import { Button } from '@comprobify/ui/components/button';
import { useTranslations } from 'next-intl';
import { ActionForm } from '@/components/action-form';
import { goLiveAction } from './actions';

export function GoLiveForm() {
  const t = useTranslations('goLive');
  return (
    <ActionForm action={goLiveAction} errors="goLiveError" className="space-y-4">
      {(pending) => (
        <>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="confirm"
              required
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            {t('confirm')}
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? t('submitting') : t('submit')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}
