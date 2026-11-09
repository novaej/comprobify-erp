'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Textarea } from '@comprobify/ui/components/textarea';
import { Ban, HandCoins } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { DetailTile } from '@/components/detail-tile';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import { ToneBadge, type Tone } from '@/components/tone-badge';
import { recordPaymentAction, voidPaymentAction } from '../../receivables/actions';

export type ReceivableData = {
  documentId: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  total: string;
  credited: string;
  paid: string;
  balance: string;
  dueDate: string;
  issueDate: string;
  // Today, for the payment's date.
  today: string;
  payments: {
    id: string;
    paidOn: string;
    method: string;
    methodLabel: string;
    reference: string | null;
    amount: string;
    voidedReason: string | null;
  }[];
};

const TONE: Record<ReceivableData['status'], Tone> = {
  UNPAID: 'warning',
  PARTIAL: 'info',
  PAID: 'success',
};

// FR-SAL-10: what an invoice is owed, its payments, and recording or voiding one.
export function ReceivableCard({
  data,
  methods,
  canManage,
}: {
  data: ReceivableData;
  methods: Choice[];
  canManage: boolean;
}) {
  const t = useTranslations('receivables.card');
  const locale = useLocale();
  // As the rest of the screens write money: $46,00.
  const currency = new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
  });
  // 'pay' for the payment dialog, or the id of the payment being voided.
  const [open, setOpen] = useState<string | null>(null);
  const [method, setMethod] = useState(methods[0]?.value ?? '01');
  const money = (value: string) => currency.format(value as Intl.StringNumericLiteral);
  const date = (iso: string) => iso.split('-').reverse().join('/');
  const owes = Number(data.balance) > 0;
  const voiding = data.payments.find((payment) => payment.id === open);

  return (
    <SectionCard
      title={t('title')}
      action={
        canManage && owes ? (
          <Button size="sm" onClick={() => setOpen('pay')}>
            <HandCoins className="mr-1.5 h-4 w-4" aria-hidden />
            {t('record')}
          </Button>
        ) : (
          <ToneBadge tone={TONE[data.status]}>{t(`statuses.${data.status}`)}</ToneBadge>
        )
      }
    >
      <p className="mb-3 flex items-center gap-2 text-sm">
        {canManage && owes && (
          <ToneBadge tone={TONE[data.status]}>{t(`statuses.${data.status}`)}</ToneBadge>
        )}
        <span className="text-muted-foreground">{t('due', { date: date(data.dueDate) })}</span>
      </p>
      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <DetailTile label={t('total')} value={money(data.total)} />
        {Number(data.credited) > 0 && (
          <DetailTile label={t('credited')} value={`−${money(data.credited)}`} />
        )}
        <DetailTile label={t('paid')} value={money(data.paid)} />
        <DetailTile label={t('balance')} value={money(data.balance)} />
      </dl>

      {data.payments.length > 0 ? (
        <ul aria-label={t('payments')} className="mt-4 space-y-2 text-sm">
          {data.payments.map((payment) => (
            <li
              key={payment.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/40 px-3 py-2"
            >
              <span className="tabular-nums">{date(payment.paidOn)}</span>
              <span>{payment.methodLabel}</span>
              {payment.reference && (
                <span className="break-all text-muted-foreground">{payment.reference}</span>
              )}
              {payment.voidedReason ? (
                <span className="text-muted-foreground">
                  <ToneBadge tone="neutral">{t('voided')}</ToneBadge> {payment.voidedReason}
                </span>
              ) : (
                canManage && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t('void', { amount: money(payment.amount) })}
                    onClick={() => setOpen(payment.id)}
                  >
                    <Ban className="h-4 w-4" aria-hidden />
                  </Button>
                )
              )}
              <span
                className={
                  payment.voidedReason
                    ? 'ml-auto tabular-nums text-muted-foreground line-through'
                    : 'ml-auto font-medium tabular-nums'
                }
              >
                {money(payment.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{t('none')}</p>
      )}

      <FormDialog
        open={open === 'pay'}
        onOpenChange={(next) => setOpen(next ? 'pay' : null)}
        title={t('recordTitle')}
        description={t('recordDescription', { balance: money(data.balance) })}
        submitLabel={t('recordSubmit')}
        action={recordPaymentAction}
        errors="receivablesError"
        success={t('recorded')}
        extra={{ documentId: data.documentId, method }}
      >
        <FormField label={t('amount')} required>
          {(a11y) => (
            <Input
              {...a11y}
              name="amount"
              inputMode="decimal"
              defaultValue={data.balance.replace('.', ',')}
              pattern="\d{1,12}([.,]\d{1,2})?"
              required
              autoFocus
            />
          )}
        </FormField>
        <FormField label={t('paidOn')} required>
          {(a11y) => (
            <Input
              {...a11y}
              name="paidOn"
              type="date"
              defaultValue={data.today}
              min={data.issueDate}
              max={data.today}
              required
            />
          )}
        </FormField>
        <FormField label={t('method')} required>
          {(a11y) => (
            <ChoiceSelect a11y={a11y} value={method} onChange={setMethod} options={methods} />
          )}
        </FormField>
        <FormField label={t('reference')} hint={t('referenceHint')}>
          {(a11y) => <Input {...a11y} name="reference" maxLength={100} />}
        </FormField>
      </FormDialog>

      <FormDialog
        open={Boolean(voiding)}
        onOpenChange={(next) => !next && setOpen(null)}
        title={t('voidTitle')}
        description={t('voidDescription')}
        submitLabel={t('voidSubmit')}
        action={voidPaymentAction}
        errors="receivablesError"
        success={t('voidedDone')}
        extra={{ id: voiding?.id ?? '' }}
        destructive
      >
        <FormField label={t('voidReason')} hint={t('voidReasonHint')} required>
          {(a11y) => <Textarea {...a11y} name="reason" maxLength={300} required autoFocus />}
        </FormField>
      </FormDialog>
    </SectionCard>
  );
}
