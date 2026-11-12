'use client';

import { Button } from '@comprobify/ui/components/button';
import { useTranslations } from 'next-intl';
import { ActionForm } from '@/components/action-form';
import { FormActionBar } from '@/components/form-action-bar';
import { acceptAgreementsAction } from './actions';

// One checkbox per document still pending: accepting is a separate act for each text, and each
// is recorded as its own row (FR-ONB-8).
export function AcceptAgreementsForm({ pending }: { pending: string[] }) {
  const t = useTranslations('legal');
  return (
    <ActionForm action={acceptAgreementsAction} errors="legalError" success={t('accepted')}>
      {(isPending) => (
        <FormActionBar
          summary={
            <div className="flex flex-col gap-2">
              {pending.map((type) => (
                <label key={type} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name={`accept_${type}`}
                    required
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  {t('acceptLabel', { document: t(`types.${type}`) })}
                </label>
              ))}
            </div>
          }
        >
          <Button type="submit" disabled={isPending}>
            {isPending ? t('accepting') : t('accept')}
          </Button>
        </FormActionBar>
      )}
    </ActionForm>
  );
}
