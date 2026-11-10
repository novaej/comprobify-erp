'use client';

import type { CardSession, PaymentView, ProofView } from '@comprobify/core';
import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { CreditCard, FileText, Landmark, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import { ToneBadge } from '@/components/tone-badge';
import { useServerAction } from '@/components/use-server-action';
import type { BankTransfer } from '@/server/runtime';
import {
  cancelPaymentAction,
  removeProofAction,
  startCardAction,
  submitProofAction,
} from './actions';
import { PayphoneCheckout } from './payphone-checkout';
import { usePaymentLabel } from '@/components/billing/payment-label';
import { STATUS_TONE } from '@/components/billing/payment-status';

export type OpenPayment = PaymentView & { proofs: ProofView[] };

// Payphone's widget lives about 10 minutes: an older session is minted again.
const SESSION_MINUTES = 9;

// FR-BILL-3: one open payment and the two ways to pay it. A proof under review is waiting for
// the operator, so the card isn't offered then: it could pay the same thing twice.
export function PaymentCard({
  payment,
  bankTransfer,
  cardAvailable,
  canManage,
}: {
  payment: OpenPayment;
  bankTransfer: BankTransfer | null;
  cardAvailable: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('plan.payment');
  const tError = useTranslations('planError');
  const locale = useLocale();
  const label = usePaymentLabel();
  const money = (value: string) => `$${value}`;
  const inReview = payment.status === 'REPORTED';
  const [method, setMethod] = useState<'transfer' | 'card'>('transfer');
  const [session, setSession] = useState<{ value: CardSession; at: number } | null>(null);
  const [cardError, setCardError] = useState<string>();
  const [minting, startMinting] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [removing, setRemoving] = useState<ProofView | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = useServerAction(submitProofAction, {
    errors: 'planError',
    success: t('reported'),
    onDone: () => formRef.current?.reset(),
  });
  const cancel = useServerAction(cancelPaymentAction, {
    errors: 'planError',
    success: t('cancelled'),
    onDone: () => setCancelling(false),
  });
  const remove = useServerAction(removeProofAction, {
    errors: 'planError',
    success: t('proofRemoved'),
    onDone: () => setRemoving(null),
  });

  // Minted on a click, never in an effect: each mint is a new attempt at Payphone.
  const chooseCard = () => {
    setMethod('card');
    if (session && Date.now() - session.at < SESSION_MINUTES * 60_000) return;
    setCardError(undefined);
    startMinting(async () => {
      const result = await startCardAction(locale, payment.id);
      if ('error' in result) {
        setCardError(tError.has(result.error) ? tError(result.error) : tError('UNKNOWN'));
        return;
      }
      setSession({ value: result.session, at: Date.now() });
    });
  };

  const facts: [string, string][] = [
    [t('base'), money(payment.baseAmount)],
    [t('iva', { rate: Number(payment.ivaRate) }), money(payment.ivaAmount)],
    [t('total'), money(payment.totalAmount)],
    [t('code'), payment.code],
  ];
  const canCancel =
    canManage &&
    payment.purpose !== 'RENEWAL' &&
    (payment.status === 'PENDING' || payment.status === 'REJECTED');

  return (
    <SectionCard
      title={label(payment)}
      description={inReview ? t('inReview') : t('due')}
      action={
        <ToneBadge tone={STATUS_TONE[payment.status]}>{t(`status.${payment.status}`)}</ToneBadge>
      }
      className="border-primary/30"
    >
      {payment.status === 'REJECTED' && payment.rejectionReason && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {t('rejected', { reason: t(`reasons.${payment.rejectionReason}`) })}
        </p>
      )}
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {facts.map(([name, value]) => (
          <div
            key={name}
            className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
          >
            <dt className="text-xs text-muted-foreground">{name}</dt>
            <dd className="text-sm font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {payment.proofs.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium text-muted-foreground">{t('proofs')}</h3>
          <ul className="mt-2 space-y-1.5">
            {payment.proofs.map((proof) => (
              <li
                key={proof.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
              >
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                <a
                  href={`/${locale}/plan/payments/${payment.id}/proofs/${proof.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate text-primary underline-offset-4 hover:underline"
                >
                  {proof.filename}
                </a>
                <span className="text-xs text-muted-foreground">{proof.reference}</span>
                {canManage && !inReview && (
                  <button
                    type="button"
                    onClick={() => setRemoving(proof)}
                    aria-label={t('removeProof', { file: proof.filename })}
                    title={t('removeProof', { file: proof.filename })}
                    className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManage && !inReview && (
        <div className="mt-6 space-y-4">
          <div role="group" aria-label={t('method')} className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={method === 'transfer' ? 'default' : 'outline'}
              aria-pressed={method === 'transfer'}
              onClick={() => setMethod('transfer')}
            >
              <Landmark className="mr-1.5 h-4 w-4" aria-hidden />
              {t('transfer')}
            </Button>
            {cardAvailable && (
              <Button
                type="button"
                size="sm"
                variant={method === 'card' ? 'default' : 'outline'}
                aria-pressed={method === 'card'}
                onClick={chooseCard}
                disabled={minting}
              >
                <CreditCard className="mr-1.5 h-4 w-4" aria-hidden />
                {t('card')}
              </Button>
            )}
          </div>

          {method === 'transfer' ? (
            <div className="space-y-4">
              {bankTransfer ? (
                <dl className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 text-sm sm:grid-cols-2">
                  {(
                    [
                      ['bank', bankTransfer.bankName],
                      ['accountType', bankTransfer.accountType],
                      ['accountNumber', bankTransfer.accountNumber],
                      ['accountHolder', bankTransfer.accountHolder],
                      ['identification', bankTransfer.identification],
                    ] as const
                  ).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-xs text-muted-foreground">{t(`bankFields.${key}`)}</dt>
                      <dd className="font-medium break-words">{value}</dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('bankFields.description')}</dt>
                    <dd className="font-medium">{payment.code}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noBank')}</p>
              )}
              <form
                ref={formRef}
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  form.set('paymentId', payment.id);
                  submit.run(form);
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label={t('reference')} hint={t('referenceHint')} required>
                    {(a11y) => (
                      <Input {...a11y} name="reference" required minLength={3} maxLength={60} />
                    )}
                  </FormField>
                  <FormField label={t('files')} hint={t('filesHint')} required>
                    {(a11y) => (
                      <Input
                        {...a11y}
                        type="file"
                        name="files"
                        multiple
                        required
                        accept="image/png,image/jpeg,image/gif,application/pdf"
                      />
                    )}
                  </FormField>
                </div>
                {submit.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {submit.error}
                  </p>
                )}
                <div>
                  <Button type="submit" size="sm" disabled={submit.pending}>
                    {t('report')}
                  </Button>
                </div>
              </form>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('cardHint')}</p>
              {cardError && (
                <p role="alert" className="text-sm text-destructive">
                  {cardError}
                </p>
              )}
              {session && (
                <PayphoneCheckout key={session.value.clientTransactionId} session={session.value} />
              )}
            </div>
          )}
        </div>
      )}

      {canCancel && (
        <div className="mt-6 border-t border-border pt-4">
          <Button type="button" size="sm" variant="ghost" onClick={() => setCancelling(true)}>
            {t('cancel')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t('cancelTitle')}
        description={t('cancelDescription')}
        detail={label(payment)}
        confirmLabel={t('cancel')}
        destructive
        pending={cancel.pending}
        error={cancel.error}
        onConfirm={() => cancel.run({ paymentId: payment.id })}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('removeProofTitle')}
        description={t('removeProofDescription')}
        detail={removing?.filename}
        confirmLabel={t('remove')}
        destructive
        pending={remove.pending}
        error={remove.error}
        onConfirm={() => removing && remove.run({ paymentId: payment.id, proofId: removing.id })}
      />
    </SectionCard>
  );
}
