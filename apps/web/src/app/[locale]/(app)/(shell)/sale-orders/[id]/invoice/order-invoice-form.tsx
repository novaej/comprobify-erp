'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { AlertCircle, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useRef, useState, useTransition } from 'react';
import { Banner } from '@/components/banner';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormActionBar } from '@/components/form-action-bar';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import {
  StackBody,
  StackCell,
  StackHead,
  StackHeader,
  StackRow,
  StackTable,
  TableCard,
} from '@/components/stack-table';
import { formatCents, formTotals, normalizeDecimal, parseDecimal } from '@/lib/invoice-totals';
import { correctOrderInvoiceAction, invoiceOrderAction } from '../../actions';

export type OrderLineOption = {
  orderLineId: string;
  code: string;
  name: string;
  unit: string | null;
  unitPrice: string;
  // The line's whole discount, shared out by quantity as core does.
  discount: string;
  quantity: string;
  ivaRateCode: string;
  ivaLabel: string;
  // What is left to invoice (not counting the invoice being corrected), and what it covers now.
  left: string;
  current: string;
};

// An invoice being corrected, as last signed.
export type OrderInvoiceDraft = {
  documentId: string;
  method: string;
  term: string;
  termUnit: string;
};

// FR-SAL-3: pick what to invoice from what the order has left, and how it is paid.
export function OrderInvoiceForm({
  orderId,
  orderNumber,
  issuePoints,
  lines,
  percents,
  paymentMethods,
  termUnits,
  draft,
}: {
  orderId: string;
  orderNumber: string;
  issuePoints: Choice[];
  lines: OrderLineOption[];
  // IVA rate code → percent, for the live total.
  percents: Record<string, string>;
  paymentMethods: Choice[];
  termUnits: Choice[];
  draft?: OrderInvoiceDraft;
}) {
  const t = useTranslations('saleOrders.invoice');
  const tError = useTranslations('documentsError');
  const tOrderError = useTranslations('saleOrdersError');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  // One key per form, so a double click or a retry makes one invoice (FR-DOC-2).
  const key = useRef(crypto.randomUUID());
  const [issuePointId, setIssuePointId] = useState(issuePoints[0]?.value ?? '');
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lines.map((line) => [
        line.orderLineId,
        draft
          ? Number(line.current) > 0
            ? line.current.replace(/\.?0+$/, '')
            : ''
          : Number(line.left) > 0
            ? line.left.replace(/\.?0+$/, '')
            : '',
      ]),
    ),
  );
  const [method, setMethod] = useState(draft?.method ?? paymentMethods[0]?.value ?? '01');
  const [term, setTerm] = useState(draft?.term ?? '');
  const [termUnit, setTermUnit] = useState(draft?.termUnit || termUnits[0]?.value || 'dias');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const money = new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
  });
  const show = (cents: bigint) => money.format(formatCents(cents) as Intl.StringNumericLiteral);
  const ratePercents = useMemo(() => new Map(Object.entries(percents)), [percents]);

  const given = (line: OrderLineOption) => (quantities[line.orderLineId] ?? '').trim() !== '';
  const chosen = lines.filter(given);
  const over = (line: OrderLineOption) => {
    const quantity = parseDecimal(quantities[line.orderLineId] ?? '');
    const left = parseDecimal(line.left);
    return quantity !== null && left !== null && quantity > left;
  };
  const zero = (line: OrderLineOption) => parseDecimal(quantities[line.orderLineId] ?? '') === 0n;
  // The part of the line's discount that goes with this quantity (an estimate for the screen:
  // core rounds the shares so they add up, and works out the payment itself).
  const discountOf = (line: OrderLineOption) => {
    const quantity = parseDecimal(quantities[line.orderLineId] ?? '');
    const total = parseDecimal(line.quantity);
    const left = parseDecimal(line.left);
    const discount = parseDecimal(line.discount);
    if (quantity === null || total === null || left === null || discount === null || total === 0n)
      return '0';
    // Half-up, in cents: the discount in micro-units times the covered share of the line.
    const share = (covered: bigint) =>
      (discount * covered * 2n + total * 10_000n) / (total * 20_000n);
    const cents = share(total - left + quantity) - share(total - left);
    return formatCents(cents < 0n ? 0n : cents);
  };
  const totals = formTotals(
    chosen.map((line) => ({
      quantity: quantities[line.orderLineId]!,
      unitPrice: line.unitPrice,
      discount: discountOf(line),
      ivaRateCode: line.ivaRateCode,
    })),
    ratePercents,
  );
  const canSend =
    issuePointId !== '' &&
    chosen.length > 0 &&
    !totals.incomplete &&
    !chosen.some((line) => zero(line) || over(line));

  const send = () => {
    const form = new FormData();
    form.set('locale', locale);
    const content = {
      lines: chosen.map((line) => ({
        orderLineId: line.orderLineId,
        quantity: normalizeDecimal(quantities[line.orderLineId]!),
      })),
      // No amount: core gives the single payment the invoice's total.
      payments: [
        {
          method,
          amount: null,
          term: term.trim() === '' ? null : Number(term),
          termUnit: term.trim() === '' ? null : termUnit,
        },
      ],
    };
    form.set(
      'payload',
      JSON.stringify(
        draft ? content : { ...content, orderId, issuePointId, idempotencyKey: key.current },
      ),
    );
    if (draft) form.set('id', draft.documentId);
    startTransition(async () => {
      // Success redirects to the invoice; only a refusal comes back.
      const state = await (draft ? correctOrderInvoiceAction : invoiceOrderAction)({}, form);
      if (state?.error)
        setError(
          tOrderError.has(state.error)
            ? tOrderError(state.error)
            : tError.has(state.error)
              ? tError(state.error)
              : tError('UNKNOWN'),
        );
    });
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(undefined);
        if (canSend) setConfirming(true);
      }}
    >
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-6">
          <SectionCard title={t('issuing.title')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('issuing.issuePoint')} required>
                {(a11y) => (
                  <ChoiceSelect
                    a11y={a11y}
                    value={issuePointId}
                    onChange={setIssuePointId}
                    options={issuePoints}
                    disabled={issuePoints.length < 2 || Boolean(draft)}
                  />
                )}
              </FormField>
              <FormField label={t('issuing.order')}>
                {(a11y) => <Input {...a11y} value={orderNumber} readOnly className="bg-muted/40" />}
              </FormField>
            </div>
          </SectionCard>

          <section aria-labelledby="invoice-lines-title">
            <h2 id="invoice-lines-title" className="mb-1 text-sm font-semibold">
              {t('lines.title')}
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              {draft ? t('lines.descriptionCorrect') : t('lines.description')}
            </p>
            <TableCard>
              <StackTable aria-labelledby="invoice-lines-title">
                <StackHeader>
                  <StackRow className="bg-muted/40">
                    <StackHead className="pl-4">{t('lines.item')}</StackHead>
                    <StackHead className="text-right">{t('lines.left')}</StackHead>
                    <StackHead className="w-48 min-w-48">{t('lines.quantity')}</StackHead>
                    <StackHead className="w-28 pr-4 text-right">{t('lines.unitPrice')}</StackHead>
                  </StackRow>
                </StackHeader>
                <StackBody>
                  {lines.map((line) => {
                    const exhausted = Number(line.left) <= 0;
                    return (
                      <StackRow key={line.orderLineId}>
                        <StackCell heading className="pl-4">
                          <p className="font-medium">{line.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {line.code} · {line.ivaLabel}
                          </p>
                        </StackCell>
                        <StackCell label={t('lines.left')} className="text-right tabular-nums">
                          {line.left.replace(/\.?0+$/, '') || '0'}
                          {line.unit && (
                            <span className="ml-1 text-xs text-muted-foreground">{line.unit}</span>
                          )}
                        </StackCell>
                        <StackCell label={t('lines.quantity')}>
                          <div className="flex items-center gap-1">
                            <Input
                              inputMode="decimal"
                              aria-label={t('lines.quantityFor', { name: line.name })}
                              aria-invalid={over(line) || undefined}
                              value={quantities[line.orderLineId] ?? ''}
                              disabled={exhausted}
                              onChange={(event) =>
                                setQuantities((current) => ({
                                  ...current,
                                  [line.orderLineId]: event.target.value,
                                }))
                              }
                              className="min-w-20 flex-1 text-right tabular-nums"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={exhausted}
                              onClick={() =>
                                setQuantities((current) => ({
                                  ...current,
                                  [line.orderLineId]: line.left.replace(/\.?0+$/, ''),
                                }))
                              }
                            >
                              {t('lines.all')}
                            </Button>
                          </div>
                          {over(line) && (
                            <p role="alert" className="mt-1 text-xs text-destructive">
                              {t('lines.over')}
                            </p>
                          )}
                        </StackCell>
                        <StackCell
                          label={t('lines.unitPrice')}
                          className="pr-4 text-right tabular-nums"
                        >
                          {Number(line.unitPrice).toLocaleString(locale === 'en' ? 'en' : 'es-EC', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 6,
                          })}
                        </StackCell>
                      </StackRow>
                    );
                  })}
                </StackBody>
              </StackTable>
            </TableCard>
          </section>

          <SectionCard title={t('payment.title')} description={t('payment.description')}>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_8rem]">
              <FormField label={t('payment.method')}>
                {(a11y) => (
                  <ChoiceSelect
                    a11y={a11y}
                    value={method}
                    options={paymentMethods}
                    onChange={setMethod}
                  />
                )}
              </FormField>
              <FormField label={t('payment.term')}>
                {(a11y) => (
                  <Input
                    {...a11y}
                    inputMode="numeric"
                    className="text-right tabular-nums"
                    value={term}
                    onChange={(event) => setTerm(event.target.value)}
                  />
                )}
              </FormField>
              <FormField label={t('payment.termUnit')}>
                {(a11y) => (
                  <ChoiceSelect
                    a11y={a11y}
                    value={termUnit}
                    options={termUnits}
                    onChange={setTermUnit}
                  />
                )}
              </FormField>
            </div>
          </SectionCard>
        </div>

        <SectionCard title={t('totals.title')} className="xl:sticky xl:top-6">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('totals.subtotal')}</dt>
              <dd className="tabular-nums">{show(totals.subtotal)}</dd>
            </div>
            {totals.groups
              .filter((group) => group.iva > 0n)
              .map((group) => (
                <div key={group.rateCode} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">
                    {t('totals.iva', { percent: group.percent })}
                  </dt>
                  <dd className="tabular-nums">{show(group.iva)}</dd>
                </div>
              ))}
            <div className="flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
              <dt>{t('totals.total')}</dt>
              <dd className="tabular-nums">{show(totals.total)}</dd>
            </div>
          </dl>
        </SectionCard>
      </div>

      {error && (
        <Banner tone="danger" icon={AlertCircle} role="alert" className="mt-6 mb-0">
          {error}
        </Banner>
      )}
      <FormActionBar>
        <Button type="submit" disabled={pending || !canSend}>
          <Send className="mr-1.5 h-4 w-4" aria-hidden />
          {draft ? t('correct.submit') : t('submit')}
        </Button>
      </FormActionBar>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          setConfirming(open);
          if (!open) setError(undefined);
        }}
        title={draft ? t('correct.confirmTitle') : t('confirmTitle')}
        description={draft ? t('correct.confirmDescription') : t('confirmDescription')}
        detail={t('confirmDetail', { order: orderNumber, total: show(totals.total) })}
        confirmLabel={draft ? t('correct.submit') : t('submit')}
        pending={pending}
        error={error}
        onConfirm={send}
      />
    </form>
  );
}
