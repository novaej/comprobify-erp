'use client';

import { Button, buttonVariants } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Textarea } from '@comprobify/ui/components/textarea';
import { Ban, Lock, Mail, PackageCheck, PencilLine, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { useServerAction } from '@/components/use-server-action';
import { Link } from '@/i18n/navigation';
import { emailOrderAction, orderStatusAction } from '../actions';

export type OrderAllowed = {
  edit: boolean;
  send: boolean;
  email: boolean;
  receive: boolean;
  cancel: boolean;
  close: boolean;
};

// FR-PUR-1: what the order allows now, each asked first (FR-UX-2).
export function OrderActions({
  id,
  number,
  allowed,
  short,
  providerEmails,
  draft,
}: {
  id: string;
  number: string;
  allowed: OrderAllowed;
  // The provider's addresses, offered as the recipients.
  providerEmails: string[];
  // Emailing a draft also marks it sent.
  draft: boolean;
  // Closing before everything arrived says so.
  short: boolean;
}) {
  const t = useTranslations('purchaseOrders.actions');
  const [open, setOpen] = useState<'send' | 'email' | 'cancel' | 'close' | null>(null);
  const close = () => setOpen(null);
  const send = useServerAction(orderStatusAction, {
    errors: 'purchaseOrdersError',
    success: t('sent'),
    onDone: close,
  });
  const finish = useServerAction(orderStatusAction, {
    errors: 'purchaseOrdersError',
    success: t('closed'),
    onDone: close,
  });

  if (!Object.values(allowed).some(Boolean)) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {allowed.edit && (
        <Link href={`/purchase-orders/${id}/edit`} className={buttonVariants({ size: 'sm' })}>
          <PencilLine className="mr-1.5 h-4 w-4" aria-hidden />
          {t('edit')}
        </Link>
      )}
      {allowed.receive && (
        <Link href={`/purchase-orders/${id}/receive`} className={buttonVariants({ size: 'sm' })}>
          <PackageCheck className="mr-1.5 h-4 w-4" aria-hidden />
          {t('receive')}
        </Link>
      )}
      {allowed.email && (
        <Button size="sm" variant={draft ? 'default' : 'outline'} onClick={() => setOpen('email')}>
          <Mail className="mr-1.5 h-4 w-4" aria-hidden />
          {draft ? t('email') : t('emailAgain')}
        </Button>
      )}
      {allowed.send && (
        <Button size="sm" variant="outline" onClick={() => setOpen('send')}>
          <Send className="mr-1.5 h-4 w-4" aria-hidden />
          {t('send')}
        </Button>
      )}
      {allowed.close && (
        <Button size="sm" variant="outline" onClick={() => setOpen('close')}>
          <Lock className="mr-1.5 h-4 w-4" aria-hidden />
          {t('close')}
        </Button>
      )}
      {allowed.cancel && (
        <Button size="sm" variant="outline" onClick={() => setOpen('cancel')}>
          <Ban className="mr-1.5 h-4 w-4" aria-hidden />
          {t('cancel')}
        </Button>
      )}

      <ConfirmDialog
        open={open === 'send'}
        onOpenChange={(next) => !next && close()}
        title={t('sendTitle')}
        description={t('sendDescription')}
        detail={number}
        confirmLabel={t('send')}
        pending={send.pending}
        error={send.error}
        onConfirm={() => send.run({ id, change: 'send' })}
      />
      <ConfirmDialog
        open={open === 'close'}
        onOpenChange={(next) => !next && close()}
        title={t('closeTitle')}
        description={short ? `${t('closeDescription')} ${t('closeShort')}` : t('closeDescription')}
        detail={number}
        confirmLabel={t('close')}
        destructive={short}
        pending={finish.pending}
        error={finish.error}
        onConfirm={() => finish.run({ id, change: 'close' })}
      />
      <FormDialog
        open={open === 'email'}
        onOpenChange={(next) => setOpen(next ? 'email' : null)}
        title={draft ? t('emailTitle') : t('emailAgainTitle')}
        description={draft ? t('emailDescription') : t('emailAgainDescription')}
        submitLabel={t('emailSubmit')}
        action={emailOrderAction}
        errors="purchaseOrdersError"
        success={t('emailed')}
        extra={{ id }}
      >
        <FormField label={t('emailTo')} hint={t('emailToHint')} required>
          {(a11y) => (
            <Input
              {...a11y}
              name="to"
              inputMode="email"
              defaultValue={providerEmails.join(', ')}
              required
              autoFocus
            />
          )}
        </FormField>
      </FormDialog>
      <FormDialog
        open={open === 'cancel'}
        onOpenChange={(next) => setOpen(next ? 'cancel' : null)}
        title={t('cancelTitle')}
        description={t('cancelDescription')}
        submitLabel={t('cancelSubmit')}
        action={orderStatusAction}
        errors="purchaseOrdersError"
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
