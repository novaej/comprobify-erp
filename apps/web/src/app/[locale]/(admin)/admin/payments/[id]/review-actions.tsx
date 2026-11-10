'use client';

import { Button } from '@comprobify/ui/components/button';
import { Textarea } from '@comprobify/ui/components/textarea';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChoiceSelect } from '@/components/choice-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { useServerAction } from '@/components/use-server-action';
import { refundPaymentAction, rejectPaymentAction, verifyPaymentAction } from '../actions';

// FR-BILL-3, FR-BILL-8: the operator's decision on one payment. Verifying grants access at once;
// refunding restores the subscription as it was before this payment and moves no money.
export function ReviewActions({
  paymentId,
  status,
  label,
  reasons,
}: {
  paymentId: string;
  status: string;
  label: string;
  // From core, through the page: a client file never imports core.
  reasons: readonly string[];
}) {
  const t = useTranslations('adminPayments.review');
  const tReasons = useTranslations('plan.payment.reasons');
  const [dialog, setDialog] = useState<'verify' | 'reject' | 'refund' | null>(null);
  const [reason, setReason] = useState<string>(reasons[0] ?? 'OTHER');
  const verify = useServerAction(verifyPaymentAction, {
    errors: 'adminError',
    success: t('verified'),
    onDone: () => setDialog(null),
  });
  const close = (open: boolean) => !open && setDialog(null);

  return (
    <div className="flex flex-wrap gap-2">
      {status === 'REPORTED' && (
        <>
          <Button size="sm" onClick={() => setDialog('verify')}>
            {t('verify')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog('reject')}>
            {t('reject')}
          </Button>
        </>
      )}
      {status === 'VERIFIED' && (
        <Button size="sm" variant="outline" onClick={() => setDialog('refund')}>
          {t('refund')}
        </Button>
      )}

      <ConfirmDialog
        open={dialog === 'verify'}
        onOpenChange={close}
        title={t('verifyTitle')}
        description={t('verifyDescription')}
        detail={label}
        confirmLabel={t('verify')}
        pending={verify.pending}
        error={verify.error}
        onConfirm={() => verify.run({ paymentId })}
      />
      <FormDialog
        open={dialog === 'reject'}
        onOpenChange={close}
        title={t('rejectTitle')}
        description={t('rejectDescription')}
        submitLabel={t('reject')}
        action={rejectPaymentAction}
        errors="adminError"
        success={t('rejected')}
        destructive
        extra={{ paymentId, reason }}
      >
        <FormField label={t('reason')}>
          {(a11y) => (
            <ChoiceSelect
              a11y={a11y}
              value={reason}
              onChange={setReason}
              options={reasons.map((value) => ({
                value,
                label: tReasons(value),
              }))}
            />
          )}
        </FormField>
      </FormDialog>
      <FormDialog
        open={dialog === 'refund'}
        onOpenChange={close}
        title={t('refundTitle')}
        description={t('refundDescription')}
        submitLabel={t('refund')}
        action={refundPaymentAction}
        errors="adminError"
        success={t('refunded')}
        destructive
        extra={{ paymentId }}
      >
        <FormField label={t('refundReason')} required>
          {(a11y) => <Textarea {...a11y} name="reason" required minLength={3} maxLength={300} />}
        </FormField>
      </FormDialog>
    </div>
  );
}
