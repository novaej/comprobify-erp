'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Switch } from '@comprobify/ui/components/switch';
import { Textarea } from '@comprobify/ui/components/textarea';
import { AlertCircle, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState, useTransition } from 'react';
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
import { correctCreditNoteAction, createCreditNoteAction } from './actions';

export type BalanceLine = {
  position: number;
  code: string;
  name: string;
  ivaRateCode: string;
  ivaLabel: string;
  unitPrice: string;
  remainingQuantity: string;
  remainingBase: string;
};

type Kind = 'RETURN' | 'AMOUNT';

export type CreditDraft = {
  documentId: string;
  reason: string;
  returnStock: boolean;
  lines: {
    sourcePosition: number;
    kind: Kind;
    quantity: string;
    unitPrice: string;
    discount: string;
  }[];
};

// A RETURN credits goods at a price; an AMOUNT credits a value only, kept in `amount`.
type Entry = { kind: Kind; quantity: string; unitPrice: string; discount: string; amount: string };

// The nota de crédito form: pick what to credit from the invoice's remaining balance.
export function CreditNoteForm({
  originId,
  originNumber,
  issuePoints,
  balance,
  canReturnStock,
  percents,
  draft,
}: {
  originId: string;
  originNumber: string;
  issuePoints: Choice[];
  balance: BalanceLine[];
  // The invoice sold goods that haven't all come back (FR-SAL-8).
  canReturnStock: boolean;
  // IVA rate code → percent, for the live total.
  percents: Record<string, string>;
  draft?: CreditDraft;
}) {
  const t = useTranslations('creditNoteForm');
  const tError = useTranslations('documentsError');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [issuePointId, setIssuePointId] = useState(issuePoints[0]?.value ?? '');
  const [reason, setReason] = useState(draft?.reason ?? '');
  const [returnStock, setReturnStock] = useState(draft?.returnStock ?? false);
  const uid = useId();
  const [entries, setEntries] = useState<Record<number, Entry>>(() =>
    Object.fromEntries(
      balance.map((line) => {
        const used = draft?.lines.find((item) => item.sourcePosition === line.position);
        return [
          line.position,
          {
            kind: used?.kind ?? 'RETURN',
            quantity: used?.kind === 'AMOUNT' ? '' : (used?.quantity ?? ''),
            unitPrice:
              used?.kind === 'AMOUNT' ? line.unitPrice : (used?.unitPrice ?? line.unitPrice),
            discount: used && Number(used.discount) > 0 ? used.discount : '',
            amount: used?.kind === 'AMOUNT' ? used.unitPrice : '',
          },
        ];
      }),
    ),
  );
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const money = new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
  });
  const show = (cents: bigint) => money.format(formatCents(cents) as Intl.StringNumericLiteral);

  const set = (position: number, change: Partial<Entry>) =>
    setEntries((current) => ({ ...current, [position]: { ...current[position]!, ...change } }));
  const given = (line: BalanceLine) => {
    const entry = entries[line.position];
    return ((entry?.kind === 'AMOUNT' ? entry.amount : entry?.quantity) ?? '').trim() !== '';
  };
  const chosen = balance.filter(given);
  const ratePercents = useMemo(() => new Map(Object.entries(percents)), [percents]);
  const totals = formTotals(
    chosen.map((line) => {
      const entry = entries[line.position]!;
      return {
        ...(entry.kind === 'AMOUNT'
          ? { quantity: '1', unitPrice: entry.amount, discount: '' }
          : entry),
        ivaRateCode: line.ivaRateCode,
      };
    }),
    ratePercents,
  );
  // Over the balance is core's call, but a screen can say so before sending.
  const over = (line: BalanceLine) => {
    const entry = entries[line.position];
    if (entry?.kind === 'AMOUNT') {
      const amount = parseDecimal(entry.amount);
      const left = parseDecimal(line.remainingBase);
      return amount !== null && left !== null && amount > left;
    }
    const quantity = parseDecimal(entry?.quantity ?? '');
    const left = parseDecimal(line.remainingQuantity);
    return quantity !== null && left !== null && quantity > left;
  };
  // A return is also held to the value left: after a discount, the units may not fit at full price.
  const overValue = (line: BalanceLine) => {
    const entry = entries[line.position];
    if (!entry || entry.kind === 'AMOUNT' || !given(line)) return false;
    const left = parseDecimal(line.remainingBase);
    const value = formTotals([{ ...entry, ivaRateCode: line.ivaRateCode }], ratePercents).subtotal;
    return left !== null && value > left / 10_000n;
  };
  const isZero = (line: BalanceLine) => {
    const entry = entries[line.position]!;
    return parseDecimal(entry.kind === 'AMOUNT' ? entry.amount : entry.quantity) === 0n;
  };
  const canSend =
    reason.trim() !== '' &&
    issuePointId !== '' &&
    chosen.length > 0 &&
    !totals.incomplete &&
    !chosen.some((line) => isZero(line) || over(line) || overValue(line));

  const send = () => {
    const form = new FormData();
    form.set('locale', locale);
    const lines = chosen.map((line) => {
      const entry = entries[line.position]!;
      if (entry.kind === 'AMOUNT')
        return {
          sourcePosition: line.position,
          kind: 'AMOUNT' as const,
          quantity: '1',
          unitPrice: normalizeDecimal(entry.amount),
          discount: '0',
        };
      const price = normalizeDecimal(entry.unitPrice);
      return {
        sourcePosition: line.position,
        kind: 'RETURN' as const,
        quantity: normalizeDecimal(entry.quantity),
        // The invoice's own price is the default; only a different one is sent.
        unitPrice: price === '' || price === line.unitPrice ? null : price,
        discount: normalizeDecimal(entry.discount) || '0',
      };
    });
    const content = { reason: reason.trim(), lines, returnStock: canReturnStock && returnStock };
    form.set(
      'payload',
      JSON.stringify(
        draft ? content : { ...content, originId, issuePointId, idempotencyKey: null },
      ),
    );
    if (draft) form.set('id', draft.documentId);
    startTransition(async () => {
      // Success redirects to the credit note; only a refusal comes back.
      const state = await (draft ? correctCreditNoteAction : createCreditNoteAction)({}, form);
      if (state?.error) setError(tError.has(state.error) ? tError(state.error) : tError('UNKNOWN'));
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
      <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_19rem]">
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
              <FormField label={t('issuing.origin')}>
                {(a11y) => (
                  <Input {...a11y} value={originNumber} readOnly className="bg-muted/40" />
                )}
              </FormField>
            </div>
            <FormField className="mt-4" label={t('reason.label')} hint={t('reason.hint')} required>
              {(a11y) => (
                <Textarea
                  {...a11y}
                  value={reason}
                  maxLength={300}
                  onChange={(event) => setReason(event.target.value)}
                />
              )}
            </FormField>
            {canReturnStock && (
              <div className="mt-4 flex items-start justify-between gap-4">
                <div>
                  <p id={`${uid}-stock`} className="text-sm font-medium">
                    {t('returnStock.label')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{t('returnStock.hint')}</p>
                </div>
                <Switch
                  checked={returnStock}
                  onCheckedChange={setReturnStock}
                  aria-labelledby={`${uid}-stock`}
                />
              </div>
            )}
          </SectionCard>

          <section aria-labelledby="credit-lines-title">
            <h2 id="credit-lines-title" className="mb-1 text-sm font-semibold">
              {t('lines.title')}
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">{t('lines.description')}</p>
            <TableCard>
              <StackTable aria-labelledby="credit-lines-title">
                <StackHeader>
                  <StackRow className="bg-muted/40">
                    <StackHead className="pl-4">{t('lines.item')}</StackHead>
                    <StackHead className="w-36">{t('lines.kind')}</StackHead>
                    <StackHead className="text-right">{t('lines.left')}</StackHead>
                    <StackHead className="w-48 min-w-48">{t('lines.quantity')}</StackHead>
                    <StackHead className="w-32">{t('lines.unitPrice')}</StackHead>
                    <StackHead className="w-28 pr-4">{t('lines.discount')}</StackHead>
                  </StackRow>
                </StackHeader>
                <StackBody>
                  {balance.map((line) => {
                    const entry = entries[line.position]!;
                    const exhausted = Number(line.remainingQuantity) <= 0;
                    return (
                      <StackRow key={line.position}>
                        <StackCell heading className="pl-4">
                          <p className="font-medium">{line.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {line.code} · {line.ivaLabel}
                          </p>
                        </StackCell>
                        <StackCell label={t('lines.kind')}>
                          <ChoiceSelect
                            label={t('lines.kindFor', { name: line.name })}
                            value={entry.kind}
                            disabled={exhausted}
                            onChange={(kind) => set(line.position, { kind: kind as Kind })}
                            options={[
                              { value: 'RETURN', label: t('lines.kindReturn') },
                              { value: 'AMOUNT', label: t('lines.kindAmount') },
                            ]}
                          />
                        </StackCell>
                        <StackCell label={t('lines.left')} className="text-right tabular-nums">
                          {line.remainingQuantity}
                          <span className="block text-xs text-muted-foreground">
                            {t('lines.leftBase', { amount: line.remainingBase })}
                          </span>
                        </StackCell>
                        <StackCell label={t('lines.quantity')}>
                          {entry.kind === 'AMOUNT' ? (
                            <p className="py-2 text-right text-sm text-muted-foreground tabular-nums">
                              1
                            </p>
                          ) : (
                            <>
                              <div className="flex items-center gap-1">
                                <Input
                                  inputMode="decimal"
                                  aria-label={t('lines.quantityFor', { name: line.name })}
                                  aria-invalid={over(line) || overValue(line) || undefined}
                                  value={entry.quantity}
                                  disabled={exhausted}
                                  onChange={(event) =>
                                    set(line.position, { quantity: event.target.value })
                                  }
                                  className="min-w-20 flex-1 text-right tabular-nums"
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={exhausted}
                                  onClick={() =>
                                    set(line.position, { quantity: line.remainingQuantity })
                                  }
                                >
                                  {t('lines.all')}
                                </Button>
                              </div>
                              {(over(line) || overValue(line)) && (
                                <p role="alert" className="mt-1 text-xs text-destructive">
                                  {over(line) ? t('lines.over') : t('lines.overAmount')}
                                </p>
                              )}
                            </>
                          )}
                        </StackCell>
                        <StackCell label={t('lines.unitPrice')}>
                          {entry.kind === 'AMOUNT' ? (
                            <>
                              <Input
                                inputMode="decimal"
                                aria-label={t('lines.amountFor', { name: line.name })}
                                aria-invalid={over(line) || undefined}
                                placeholder={t('lines.amountPlaceholder')}
                                value={entry.amount}
                                disabled={exhausted}
                                onChange={(event) =>
                                  set(line.position, { amount: event.target.value })
                                }
                                className="text-right tabular-nums"
                              />
                              {over(line) && (
                                <p role="alert" className="mt-1 text-xs text-destructive">
                                  {t('lines.overAmount')}
                                </p>
                              )}
                            </>
                          ) : (
                            <Input
                              inputMode="decimal"
                              aria-label={t('lines.priceFor', { name: line.name })}
                              value={entry.unitPrice}
                              disabled={exhausted}
                              onChange={(event) =>
                                set(line.position, { unitPrice: event.target.value })
                              }
                              className="text-right tabular-nums"
                            />
                          )}
                        </StackCell>
                        <StackCell label={t('lines.discount')} className="pr-4">
                          <Input
                            inputMode="decimal"
                            aria-label={t('lines.discountFor', { name: line.name })}
                            value={entry.kind === 'AMOUNT' ? '' : entry.discount}
                            disabled={exhausted || entry.kind === 'AMOUNT'}
                            onChange={(event) =>
                              set(line.position, { discount: event.target.value })
                            }
                            className="text-right tabular-nums"
                          />
                        </StackCell>
                      </StackRow>
                    );
                  })}
                </StackBody>
              </StackTable>
            </TableCard>
          </section>
        </div>

        <aside className="space-y-6 2xl:sticky 2xl:top-6">
          <section
            aria-labelledby="credit-totals-title"
            className="rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <h2 id="credit-totals-title" className="text-sm font-semibold">
              {t('totals.title')}
            </h2>
            <dl className="mt-4 space-y-2 text-sm">
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
            </dl>
            <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-border pt-4">
              <span className="text-sm font-medium">{t('totals.total')}</span>
              <output className="text-2xl font-semibold tracking-tight tabular-nums">
                {show(totals.total)}
              </output>
            </div>
            {totals.incomplete && (
              <p className="mt-2 text-xs text-muted-foreground">{t('totals.incomplete')}</p>
            )}
          </section>
        </aside>
      </div>

      {error && (
        <Banner tone="danger" icon={AlertCircle} className="mt-6 mb-0">
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
        detail={t('confirmDetail', { origin: originNumber, total: show(totals.total) })}
        confirmLabel={draft ? t('correct.submit') : t('submit')}
        pending={pending}
        error={error}
        onConfirm={send}
      />
    </form>
  );
}
