'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { markInvoicedAction } from '../payments/actions';

// FR-BILL-4: the invoice the operator issued for one payment, recorded by its access key.
export function InvoiceButton({ paymentId, label }: { paymentId: string; label: string }) {
  const t = useTranslations('adminInvoicing');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t('record')}
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
    </>
  );
}
