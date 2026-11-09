'use client';

import { Button, buttonVariants } from '@comprobify/ui/components/button';
import { Textarea } from '@comprobify/ui/components/textarea';
import { Ban, CircleCheck, PencilLine } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { useServerAction } from '@/components/use-server-action';
import { Link } from '@/i18n/navigation';
import { saleOrderStatusAction } from '../actions';

export type OrderAllowed = { edit: boolean; confirm: boolean; cancel: boolean };

// FR-SAL-1: what the order allows now, each asked first (FR-UX-2).
export function OrderActions({
  id,
  number,
  allowed,
}: {
  id: string;
  number: string;
  allowed: OrderAllowed;
}) {
  const t = useTranslations('saleOrders.actions');
  const [open, setOpen] = useState<'confirm' | 'cancel' | null>(null);
  const close = () => setOpen(null);
  const confirm = useServerAction(saleOrderStatusAction, {
    errors: 'saleOrdersError',
    success: t('confirmed'),
    onDone: close,
  });

  if (!Object.values(allowed).some(Boolean)) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {allowed.confirm && (
        <Button size="sm" onClick={() => setOpen('confirm')}>
          <CircleCheck className="mr-1.5 h-4 w-4" aria-hidden />
          {t('confirm')}
        </Button>
      )}
      {allowed.edit && (
        <Link
          href={`/sale-orders/${id}/edit`}
          className={buttonVariants({
            size: 'sm',
            variant: allowed.confirm ? 'outline' : 'default',
          })}
        >
          <PencilLine className="mr-1.5 h-4 w-4" aria-hidden />
          {t('edit')}
        </Link>
      )}
      {allowed.cancel && (
        <Button size="sm" variant="outline" onClick={() => setOpen('cancel')}>
          <Ban className="mr-1.5 h-4 w-4" aria-hidden />
          {t('cancel')}
        </Button>
      )}

      <ConfirmDialog
        open={open === 'confirm'}
        onOpenChange={(next) => !next && close()}
        title={t('confirmTitle')}
        description={t('confirmDescription')}
        detail={number}
        confirmLabel={t('confirm')}
        pending={confirm.pending}
        error={confirm.error}
        onConfirm={() => confirm.run({ id, change: 'confirm' })}
      />
      <FormDialog
        open={open === 'cancel'}
        onOpenChange={(next) => setOpen(next ? 'cancel' : null)}
        title={t('cancelTitle')}
        description={t('cancelDescription')}
        submitLabel={t('cancelSubmit')}
        action={saleOrderStatusAction}
        errors="saleOrdersError"
        success={t('cancelled')}
        extra={{ id, change: 'cancel' }}
        destructive
      >
        <FormField label={t('cancelReason')} hint={t('cancelReasonHint')} required>
          {(a11y) => <Textarea {...a11y} name="reason" maxLength={300} required autoFocus />}
        </FormField>
      </FormDialog>
    </div>
  );
}
