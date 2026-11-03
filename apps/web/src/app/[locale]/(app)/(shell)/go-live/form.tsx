'use client';

import { Button } from '@comprobify/ui/components/button';
import { useTranslations } from 'next-intl';
import { ActionForm } from '@/components/action-form';
import { FormActionBar } from '@/components/form-action-bar';
import { goLiveAction } from './actions';

// The box is the confirmation: it can't be undone, so it is read before the button.
export function GoLiveForm() {
  const t = useTranslations('goLive');
  return (
    <ActionForm action={goLiveAction} errors="goLiveError">
      {(pending) => (
        <FormActionBar
          summary={
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name="confirm"
                required
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              {t('confirm')}
            </label>
          }
        >
          <Button type="submit" disabled={pending}>
            {pending ? t('submitting') : t('submit')}
          </Button>
        </FormActionBar>
      )}
    </ActionForm>
  );
}
