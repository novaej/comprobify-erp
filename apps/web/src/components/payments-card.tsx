'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { cn } from '@comprobify/ui/lib/utils';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatCents, parseDecimal } from '@/lib/invoice-totals';
import { ChoiceSelect, type Choice } from './choice-select';
import { FormField } from './form-field';
import { SectionCard } from './section-card';

export type PaymentRow = {
  key: string;
  method: string;
  amount: string;
  term: string;
  termUnit: string;
};

export const newPayment = (method: string): PaymentRow => ({
  key: crypto.randomUUID(),
  method,
  amount: '',
  term: '',
  termUnit: '',
});

// What each payment pays, as text. The first carries the whole total when alone; with `firstTakesRest`
// it always carries what the others leave, since core works out the exact total (an order's invoice).
export function paymentAmounts(payments: PaymentRow[], total: bigint, firstTakesRest = false) {
  if (payments.length === 1) return [formatCents(total)];
  if (!firstTakesRest) return payments.map((payment) => payment.amount);
  const others = payments.slice(1).reduce((sum, payment) => {
    const value = parseDecimal(payment.amount || '0');
    return value === null ? sum : sum + value / 10_000n;
  }, 0n);
  return [formatCents(total - others), ...payments.slice(1).map((payment) => payment.amount)];
}

// Total minus what the payments add up to, in cents: zero when they match.
export function paymentDifference(amounts: string[], total: bigint) {
  const paid = amounts.reduce((sum, amount) => {
    const value = parseDecimal(amount || '0');
    return value === null ? sum : sum + value / 10_000n;
  }, 0n);
  return total - paid;
}

// Whether the payments can be sent: they add up to the total, or, with the first taking the rest,
// the others leave it something.
export function paymentsMatch(payments: PaymentRow[], total: bigint, firstTakesRest = false) {
  const amounts = paymentAmounts(payments, total, firstTakesRest);
  if (firstTakesRest && payments.length > 1) {
    const rest = parseDecimal(amounts[0]!);
    return rest !== null && rest > 0n;
  }
  return paymentDifference(amounts, total) === 0n;
}

// FR-DOC-2, FR-SAL-3: the invoice's formas de pago, one or several, each with its plazo.
export function PaymentsCard({
  payments,
  onChange,
  paymentMethods,
  termUnits,
  total,
  mark,
  show,
  firstTakesRest = false,
  description,
}: {
  payments: PaymentRow[];
  onChange: (update: (current: PaymentRow[]) => PaymentRow[]) => void;
  paymentMethods: Choice[];
  termUnits: Choice[];
  // Cents.
  total: bigint;
  // The decimal mark the amounts are typed with.
  mark: string;
  show: (cents: bigint) => string;
  firstTakesRest?: boolean;
  description?: string;
}) {
  const t = useTranslations('invoiceForm');
  const single = payments.length === 1;
  const amounts = paymentAmounts(payments, total, firstTakesRest);
  const difference = paymentDifference(amounts, total);
  const restEmpty = firstTakesRest && !paymentsMatch(payments, total, true);
  const set = (key: string, change: Partial<PaymentRow>) =>
    onChange((current) =>
      current.map((item) => (item.key === key ? { ...item, ...change } : item)),
    );

  return (
    <SectionCard
      title={t('payment.title')}
      description={description}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange((current) => [
              ...current.map((payment, index) =>
                // The first payment keeps the total it showed.
                index === 0 && current.length === 1 && !firstTakesRest
                  ? { ...payment, amount: formatCents(total) }
                  : payment,
              ),
              newPayment(paymentMethods[0]?.value ?? '01'),
            ])
          }
        >
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          {t('payment.add')}
        </Button>
      }
    >
      <ol className="space-y-3">
        {payments.map((payment, index) => {
          const computed = single || (firstTakesRest && index === 0);
          return (
            <li
              key={payment.key}
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_5rem_7rem_2.25rem] sm:items-start"
            >
              <FormField label={t('payment.method')}>
                {(a11y) => (
                  <ChoiceSelect
                    a11y={a11y}
                    value={payment.method}
                    options={paymentMethods}
                    onChange={(method) => set(payment.key, { method })}
                  />
                )}
              </FormField>
              <FormField
                label={t('payment.amount')}
                hint={firstTakesRest && index === 0 && !single ? t('payment.rest') : undefined}
              >
                {(a11y) => (
                  <Input
                    {...a11y}
                    inputMode="decimal"
                    className="text-right tabular-nums"
                    readOnly={computed}
                    value={computed ? amounts[index]!.replace('.', mark) : payment.amount}
                    onChange={(event) => set(payment.key, { amount: event.target.value })}
                  />
                )}
              </FormField>
              <FormField label={t('payment.term')}>
                {(a11y) => (
                  <Input
                    {...a11y}
                    inputMode="numeric"
                    className="text-right tabular-nums"
                    value={payment.term}
                    onChange={(event) => set(payment.key, { term: event.target.value })}
                  />
                )}
              </FormField>
              <FormField label={t('payment.termUnit')}>
                {(a11y) => (
                  <ChoiceSelect
                    a11y={a11y}
                    value={payment.termUnit || termUnits[0]?.value || 'dias'}
                    options={termUnits}
                    onChange={(termUnit) => set(payment.key, { termUnit })}
                  />
                )}
              </FormField>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={single}
                // Level with the fields, under their labels.
                className="sm:mt-6"
                aria-label={t('payment.remove', { number: index + 1 })}
                title={t('payment.remove', { number: index + 1 })}
                onClick={() =>
                  onChange((current) => current.filter((item) => item.key !== payment.key))
                }
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          );
        })}
      </ol>
      {!single && (
        <p
          role="status"
          className={cn(
            'mt-3 text-sm',
            difference === 0n && !restEmpty ? 'text-success' : 'text-warning',
          )}
        >
          {restEmpty
            ? t('payment.restEmpty')
            : difference === 0n
              ? t('payment.matched')
              : difference > 0n
                ? t('payment.remaining', { amount: show(difference) })
                : t('payment.over', { amount: show(-difference) })}
        </p>
      )}
    </SectionCard>
  );
}
