'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChoiceSelect } from '@/components/choice-select';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import { ToneBadge } from '@/components/tone-badge';
import { moveToCustomAction, startCustomBillingAction } from './actions';

// ADR-035: billing Personalizado. A company with no paid period starts one at the negotiated
// price; a company paying for a plan moves to it, now if it costs more, else at the period end.
export function CustomBillingCard({
  realTenantId,
  state,
  price,
  periodEnd,
}: {
  realTenantId: string;
  // What the company is in: nothing to offer when it is never charged or not paying a plan.
  state: 'UNBILLED' | 'BILLED' | 'PAYING' | 'PENDING' | 'COMPLIMENTARY' | 'NONE';
  price: string | null;
  periodEnd: string | null;
}) {
  const t = useTranslations('admin.customBilling');
  const tIntervals = useTranslations('plan.intervals');
  const [dialog, setDialog] = useState<'start' | 'move' | null>(null);
  const [interval, setInterval] = useState('MONTHLY');
  const close = (open: boolean) => !open && setDialog(null);
  if (state === 'NONE' || state === 'COMPLIMENTARY') return null;

  const description = {
    UNBILLED: price ? t('unbilled', { price }) : t('noPrice'),
    BILLED: t('billed', { price: price ?? '', date: periodEnd ?? '' }),
    PAYING: t('paying'),
    PENDING: t('pending', { price: price ?? '', date: periodEnd ?? '' }),
  }[state];

  return (
    <SectionCard
      className="mb-4"
      title={t('title')}
      description={description}
      action={
        state === 'UNBILLED' ? (
          <Button size="sm" onClick={() => setDialog('start')} disabled={!price}>
            {t('start')}
          </Button>
        ) : state === 'PAYING' ? (
          <Button size="sm" variant="outline" onClick={() => setDialog('move')}>
            {t('move')}
          </Button>
        ) : state === 'PENDING' ? (
          <ToneBadge tone="info">{t('pendingBadge', { date: periodEnd ?? '' })}</ToneBadge>
        ) : undefined
      }
    >
      <FormDialog
        open={dialog === 'start'}
        onOpenChange={close}
        title={t('startTitle')}
        description={t('startDescription', { price: price ?? '' })}
        submitLabel={t('start')}
        action={startCustomBillingAction}
        errors="adminError"
        success={t('started')}
        extra={{ realTenantId, interval }}
      >
        <FormField label={t('interval')}>
          {(a11y) => (
            <ChoiceSelect
              a11y={a11y}
              value={interval}
              onChange={setInterval}
              options={(['MONTHLY', 'YEARLY'] as const).map((value) => ({
                value,
                label: tIntervals(value),
              }))}
            />
          )}
        </FormField>
      </FormDialog>
      <FormDialog
        open={dialog === 'move'}
        onOpenChange={close}
        title={t('moveTitle')}
        description={t('moveDescription')}
        submitLabel={t('move')}
        action={moveToCustomAction}
        errors="adminError"
        success={t('moved')}
        extra={{ realTenantId }}
      >
        <FormField label={t('price')} hint={t('priceHint')} required>
          {(a11y) => (
            <Input
              {...a11y}
              name="monthlyPrice"
              inputMode="decimal"
              defaultValue={price ?? ''}
              required
            />
          )}
        </FormField>
      </FormDialog>
    </SectionCard>
  );
}
