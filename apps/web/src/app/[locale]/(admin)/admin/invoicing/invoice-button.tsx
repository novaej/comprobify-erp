'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Textarea } from '@comprobify/ui/components/textarea';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { markInvoicedAction, waiveInvoiceAction } from '../payments/actions';

// FR-BILL-4: what the operator does with a payment owed an invoice: records the invoice it issued,
// by its access key, or closes the payment with a reason when none is owed.
export function InvoiceButton({ paymentId, label }: { paymentId: string; label: string }) {
  const t = useTranslations('adminInvoicing');
  const [open, setOpen] = useState(false);
  const [waiving, setWaiving] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t('record')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setWaiving(true)}>
        {t('waive')}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('recordTitle')}
        description={t('recordDescription', { payment: label })}
        submitLabel={t('record')}
        action={markInvoicedAction}
        errors="adminError"
        success={t('recorded')}
        extra={{ paymentId }}
      >
        <FormField label={t('accessKey')} hint={t('accessKeyHint')} required>
          {(a11y) => (
            <Input
              {...a11y}
              name="accessKey"
              required
              inputMode="numeric"
              autoComplete="off"
              className="font-mono"
            />
          )}
        </FormField>
      </FormDialog>
      <FormDialog
        open={waiving}
        onOpenChange={setWaiving}
        title={t('waiveTitle')}
        description={t('waiveDescription', { payment: label })}
        submitLabel={t('waive')}
        action={waiveInvoiceAction}
        errors="adminError"
        success={t('waived')}
        extra={{ paymentId }}
      >
        <FormField label={t('waiveReason')} hint={t('waiveReasonHint')} required>
          {(a11y) => <Textarea {...a11y} name="reason" required minLength={3} maxLength={300} />}
        </FormField>
      </FormDialog>
    </>
  );
}
