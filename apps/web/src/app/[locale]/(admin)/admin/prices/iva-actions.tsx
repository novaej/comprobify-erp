'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { useServerAction } from '@/components/use-server-action';
import { scheduleIvaAction, withdrawIvaAction } from './actions';

// FR-BILL-2 (ADR-034): a new IVA rate from the date the law sets.
export function ScheduleIvaButton({ today }: { today: string }) {
  const t = useTranslations('prices.iva');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t('schedule')}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('scheduleTitle')}
        description={t('scheduleDescription')}
        submitLabel={t('schedule')}
        action={scheduleIvaAction}
        errors="pricesError"
        success={t('scheduled')}
      >
        <FormField label={t('rate')} hint={t('rateHint')} required>
          {(a11y) => <Input {...a11y} name="rate" inputMode="decimal" required />}
        </FormField>
        <FormField label={t('effectiveOn')} required>
          {(a11y) => <Input {...a11y} name="effectiveOn" type="date" min={today} required />}
        </FormField>
      </FormDialog>
    </>
  );
}

export function WithdrawIvaButton({ id, label }: { id: string; label: string }) {
  const t = useTranslations('prices.iva');
  const [open, setOpen] = useState(false);
  const withdraw = useServerAction(withdrawIvaAction, {
    errors: 'pricesError',
    success: t('withdrawn'),
    onDone: () => setOpen(false),
  });
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {t('withdraw')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('withdrawTitle')}
        description={t('withdrawDescription')}
        detail={label}
        confirmLabel={t('withdraw')}
        destructive
        pending={withdraw.pending}
        error={withdraw.error}
        onConfirm={() => withdraw.run({ id })}
      />
    </>
  );
}
