'use client';

import { Button } from '@comprobify/ui/components/button';
import { useTranslations } from 'next-intl';
import { ActionForm } from '@/components/action-form';
import { FormActionBar } from '@/components/form-action-bar';
import { acceptAgreementsAction } from './actions';

// One checkbox for the three texts, as before; each is recorded separately.
export function AcceptAgreementsForm() {
  const t = useTranslations('legal');
  return (
    <ActionForm action={acceptAgreementsAction} errors="legalError" success={t('accepted')}>
      {(pending) => (
        <FormActionBar
          summary={
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name="accept"
                required
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              {t('acceptLabel')}
            </label>
          }
        >
          <Button type="submit" disabled={pending}>
            {pending ? t('accepting') : t('accept')}
          </Button>
        </FormActionBar>
      )}
    </ActionForm>
  );
}
