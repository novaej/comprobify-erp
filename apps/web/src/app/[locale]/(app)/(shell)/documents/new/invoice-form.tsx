'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { cn } from '@comprobify/ui/lib/utils';
import { AlertCircle, Plus, Send, Trash2, UserRound, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { Banner } from '@/components/banner';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { Combobox, type ComboOption } from '@/components/combobox';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormActionBar } from '@/components/form-action-bar';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import { formatCents, formTotals, normalizeDecimal, parseDecimal } from '@/lib/invoice-totals';
import { correctInvoiceAction, createInvoiceAction } from './actions';

export type ProductOption = {
  id: string;
  code: string;
  auxiliaryCode: string | null;
  name: string;
  unit: string | null;
  price: string;
  ivaRateCode: string;
};

export type ClientOption = {
  id: string;
  idTypeLabel: string;
  identification: string;
  name: string;
  emails: string[];
  phone: string | null;
  address: string | null;
};

// The client's details as the form edits them; the identification stays.
type ClientEdit = { name: string; emails: string; phone: string; address: string };
const editOf = (client: ClientOption): ClientEdit => ({
  name: client.name,
  emails: client.emails.join(', '),
  phone: client.phone ?? '',
  address: client.address ?? '',
});
const emailList = (value: string) =>
  value
    .split(/[,;\s]+/)
    .map((email) => email.trim())
    .filter(Boolean);

type Line = {
  key: string;
  productId: string | null;
  code: string;
  auxiliaryCode: string | null;
  name: string;
  unit: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
  ivaRateCode: string;
};

type Payment = { key: string; method: string; amount: string; term: string; termUnit: string };
type Field = { key: string; name: string; value: string };

// A correction starts from the document as last signed (FR-DOC-7).
export type InvoiceDraft = {
  documentId: string;
  clientId: string | null;
  lines: Omit<Line, 'key'>[];
  payments: { method: string; amount: string; term: number | null; termUnit: string | null }[];
  additionalInfo: { name: string; value: string }[];
};

// Stored decimals as typed: no trailing zeros, the locale's mark.
const typed = (value: string, mark: string) =>
  value.includes('.') ? value.replace(/\.?0+$/, '').replace('.', mark) : value;

// The order Enter walks through a line (FR-UX-4).
const LINE_FIELDS = ['code', 'name', 'quantity', 'unitPrice', 'discount'] as const;
type LineField = (typeof LINE_FIELDS)[number];

const newKey = () => crypto.randomUUID();
const matches = (text: string, query: string) =>
  text.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es'));

// Prices show at least 2 decimals and up to 6, with the locale's decimal mark.
const priceText = (price: string, mark: string) => {
  const [whole, fraction = ''] = price.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${whole}${mark}${trimmed.padEnd(2, '0')}`;
};

export function InvoiceForm({
  issuePoints,
  ivaRates,
  products,
  clients,
  paymentMethods,
  termUnits,
  consumerFinalMax,
  today,
  defaultIvaRate,
  draft,
  canEditClient,
}: {
  issuePoints: Choice[];
  ivaRates: (Choice & { percent: string })[];
  products: ProductOption[];
  clients: ClientOption[];
  paymentMethods: Choice[];
  termUnits: Choice[];
  consumerFinalMax: string;
  today: string;
  defaultIvaRate: string;
  draft?: InvoiceDraft;
  // clients.manage: edits to the client are saved with the invoice.
  canEditClient: boolean;
}) {
  const t = useTranslations('invoiceForm');
  const tError = useTranslations('documentsError');
  const locale = useLocale();
  const mark = locale === 'en' ? '.' : ',';
  const money = useMemo(
    () =>
      new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
        style: 'currency',
        currency: 'USD',
      }),
    [locale],
  );
  const show = (cents: bigint) => money.format(formatCents(cents) as Intl.StringNumericLiteral);
  const percents = useMemo(
    () => new Map(ivaRates.map((rate) => [rate.value, rate.percent])),
    [ivaRates],
  );
  const rateLabel = (code: string) => ivaRates.find((rate) => rate.value === code)?.label ?? code;

  const blankLine = (): Line => ({
    key: newKey(),
    productId: null,
    code: '',
    auxiliaryCode: null,
    name: '',
    unit: null,
    quantity: '1',
    unitPrice: '',
    discount: '',
    ivaRateCode: defaultIvaRate,
  });

  const [issuePointId, setIssuePointId] = useState(issuePoints[0]?.value ?? '');
  const [client, setClient] = useState<ClientOption | null>(
    () => clients.find((option) => option.id === draft?.clientId) ?? null,
  );
  const [clientQuery, setClientQuery] = useState('');
  const [clientEdit, setClientEdit] = useState<ClientEdit | null>(() =>
    client ? editOf(client) : null,
  );
  const chooseClient = (next: ClientOption | null) => {
    setClient(next);
    setClientEdit(next ? editOf(next) : null);
  };
  const clientChanged =
    client !== null &&
    clientEdit !== null &&
    JSON.stringify(clientEdit) !== JSON.stringify(editOf(client));
  const [lines, setLines] = useState<Line[]>(() =>
    draft
      ? draft.lines.map((line) => ({
          ...line,
          key: newKey(),
          quantity: typed(line.quantity, mark),
          unitPrice: priceText(line.unitPrice, mark),
          discount: Number(line.discount) === 0 ? '' : typed(line.discount, mark),
        }))
      : [blankLine()],
  );
  const [payments, setPayments] = useState<Payment[]>(() =>
    draft && draft.payments.length > 0
      ? draft.payments.map((payment) => ({
          key: newKey(),
          method: payment.method,
          amount: typed(payment.amount, mark),
          term: payment.term === null ? '' : String(payment.term),
          termUnit: payment.termUnit ?? '',
        }))
      : [
          {
            key: newKey(),
            method: paymentMethods[0]?.value ?? '01',
            amount: '',
            term: '',
            termUnit: '',
          },
        ],
  );
  const [fields, setFields] = useState<Field[]>(() =>
    (draft?.additionalInfo ?? []).map((field) => ({ key: newKey(), ...field })),
  );
  const copy = draft
    ? {
        submit: t('correct.submit'),
        confirmTitle: t('correct.confirmTitle'),
        confirmDescription: t('correct.confirmDescription'),
      }
    : {
        submit: t('submit'),
        confirmTitle: t('confirmTitle'),
        confirmDescription: t('confirmDescription'),
      };
  const [announcement, setAnnouncement] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  // One per form: a double submit, or a retry after a lost answer, gets the same invoice.
  const [idempotencyKey] = useState(newKey);

  const inputs = useRef(new Map<string, HTMLInputElement>());
  const focusTarget = useRef<string | null>(null);
  const bind = (line: string, field: LineField) => (element: HTMLInputElement | null) => {
    if (element) inputs.current.set(`${line}:${field}`, element);
    else inputs.current.delete(`${line}:${field}`);
  };
  // Arriving by keyboard selects what's there, so typing replaces it.
  const moveTo = (element: HTMLInputElement | undefined) => {
    element?.focus();
    element?.select();
  };
  useEffect(() => {
    if (focusTarget.current) moveTo(inputs.current.get(focusTarget.current));
    focusTarget.current = null;
  });

  const totals = formTotals(lines, percents);
  const single = payments.length === 1;
  // One payment always carries the whole total.
  const paymentAmounts = single
    ? [formatCents(totals.total)]
    : payments.map((payment) => payment.amount);
  const paid = paymentAmounts.reduce((sum, amount) => {
    const value = parseDecimal(amount || '0');
    return value === null ? sum : sum + value / 10_000n;
  }, 0n);
  const difference = totals.total - paid;

  const updateLine = (key: string, change: Partial<Line>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );

  const addLine = () => {
    const line = blankLine();
    setLines((current) => [...current, line]);
    focusTarget.current = `${line.key}:code`;
    setAnnouncement(t('lines.added', { number: lines.length + 1 }));
  };

  const removeLine = (index: number) => {
    setLines((current) => current.filter((_, i) => i !== index));
    const neighbour = lines[index + 1] ?? lines[index - 1];
    if (neighbour) focusTarget.current = `${neighbour.key}:code`;
    setAnnouncement(t('lines.removed', { number: index + 1 }));
  };

  const pickProduct = (line: Line, product: ProductOption) => {
    updateLine(line.key, {
      productId: product.id,
      code: product.code,
      auxiliaryCode: product.auxiliaryCode,
      name: product.name,
      unit: product.unit,
      unitPrice: priceText(product.price, mark),
      ivaRateCode: percents.has(product.ivaRateCode) ? product.ivaRateCode : defaultIvaRate,
    });
    focusTarget.current = `${line.key}:quantity`;
  };

  // Enter moves along the line instead of submitting; on the discount it starts a new line.
  const onLineKey = (line: Line, field: LineField) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const next = LINE_FIELDS[LINE_FIELDS.indexOf(field) + 1];
    if (next) moveTo(inputs.current.get(`${line.key}:${next}`));
    else if (lines.at(-1)?.key === line.key) addLine();
    else {
      const following = lines[lines.findIndex((item) => item.key === line.key) + 1];
      if (following) moveTo(inputs.current.get(`${following.key}:code`));
    }
  };

  const productOptions = (query: string): ComboOption[] =>
    products
      .filter((product) => matches(product.code, query) || matches(product.name, query))
      .slice(0, 8)
      .map((product) => ({
        value: product.id,
        label: product.name,
        detail: `${product.code}, ${money.format(product.price as Intl.StringNumericLiteral)}, ${rateLabel(product.ivaRateCode)}`,
      }));

  const clientOptions: ComboOption[] = clients
    .filter(
      (option) =>
        matches(option.name, clientQuery) || option.identification.startsWith(clientQuery.trim()),
    )
    .slice(0, 8)
    .map((option) => ({
      value: option.id,
      label: option.name,
      detail: `${option.idTypeLabel} ${option.identification}`,
    }));

  const payload = () => ({
    issuePointId,
    clientId: client?.id ?? null,
    clientChanges:
      clientChanged && clientEdit && canEditClient
        ? {
            name: clientEdit.name.trim(),
            emails: emailList(clientEdit.emails),
            phone: clientEdit.phone.trim() || null,
            address: clientEdit.address.trim() || null,
          }
        : null,
    idempotencyKey,
    lines: lines.map((line) => ({
      productId: line.productId,
      code: line.code.trim(),
      auxiliaryCode: line.auxiliaryCode,
      name: line.name.trim(),
      unit: line.unit,
      quantity: normalizeDecimal(line.quantity),
      unitPrice: normalizeDecimal(line.unitPrice),
      discount: normalizeDecimal(line.discount) || '0',
      ivaRateCode: line.ivaRateCode,
    })),
    payments: payments.map((payment, index) => ({
      method: payment.method,
      amount: normalizeDecimal(paymentAmounts[index] ?? '0'),
      term: payment.term.trim() === '' ? null : Number(payment.term),
      termUnit: payment.term.trim() === '' ? null : payment.termUnit || 'dias',
    })),
    additionalInfo: fields
      .filter((field) => field.name.trim() && field.value.trim())
      .map((field) => ({ name: field.name.trim(), value: field.value.trim() })),
  });

  const issue = () => {
    const form = new FormData();
    form.set('locale', locale);
    const full = payload();
    // A correction keeps its issue point and number, and has no idempotency key.
    const content = {
      clientId: full.clientId,
      clientChanges: full.clientChanges,
      lines: full.lines,
      payments: full.payments,
      additionalInfo: full.additionalInfo,
    };
    form.set('payload', JSON.stringify(draft ? content : full));
    if (draft) form.set('id', draft.documentId);
    startTransition(async () => {
      // Success redirects to the invoice; only a refusal comes back.
      const state = await (draft ? correctInvoiceAction : createInvoiceAction)({}, form);
      if (state?.error) setError(tError.has(state.error) ? tError(state.error) : tError('UNKNOWN'));
    });
  };

  const canIssue =
    issuePointId !== '' && !totals.incomplete && lines.length > 0 && difference === 0n;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(undefined);
        if (canIssue) setConfirming(true);
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
              <FormField label={t('issuing.issueDate')} hint={t('issuing.issueDateHint')}>
                {(a11y) => <Input {...a11y} value={today} readOnly className="bg-muted/40" />}
              </FormField>
            </div>
          </SectionCard>

          <SectionCard
            title={t('buyer.title')}
            action={
              client && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    chooseClient(null);
                    setClientQuery('');
                  }}
                >
                  <X className="mr-1.5 h-4 w-4" aria-hidden />
                  {t('buyer.change')}
                </Button>
              )
            }
          >
            {client && clientEdit ? (
              <div className="space-y-4">
                <p className="flex items-center gap-2 text-sm">
                  <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="text-muted-foreground">{t('buyer.identification')}</span>
                  <span className="font-medium tabular-nums">
                    {client.idTypeLabel} {client.identification}
                  </span>
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(['name', 'emails', 'phone', 'address'] as const).map((field) => (
                    <FormField
                      key={field}
                      label={t(`buyer.${field}`)}
                      required={field === 'name'}
                      hint={field === 'emails' ? t('buyer.emailsHint') : undefined}
                      className={
                        field === 'name' || field === 'address' ? 'sm:col-span-2' : undefined
                      }
                    >
                      {(a11y) => (
                        <Input
                          {...a11y}
                          value={clientEdit[field]}
                          readOnly={!canEditClient}
                          className={canEditClient ? undefined : 'bg-muted/40'}
                          type={field === 'emails' ? 'text' : undefined}
                          inputMode={
                            field === 'emails' ? 'email' : field === 'phone' ? 'tel' : undefined
                          }
                          maxLength={field === 'phone' ? 30 : 300}
                          onChange={(event) =>
                            setClientEdit(
                              (current) => current && { ...current, [field]: event.target.value },
                            )
                          }
                        />
                      )}
                    </FormField>
                  ))}
                </div>
                {clientChanged && (
                  <p role="status" className="text-xs text-muted-foreground">
                    {t('buyer.savedOnIssue')}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <Combobox
                  label={t('buyer.search')}
                  placeholder={t('buyer.search')}
                  value={clientQuery}
                  onInputChange={setClientQuery}
                  options={clientOptions}
                  emptyText={t('buyer.noClients')}
                  listLabel={t('buyer.title')}
                  onPick={(option) =>
                    chooseClient(clients.find((item) => item.id === option.value) ?? null)
                  }
                />
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <UserRound className="h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    <span className="font-medium text-foreground">{t('buyer.consumerFinal')}</span>
                    {'. '}
                    {t('buyer.consumerFinalHint', {
                      max: money.format(consumerFinalMax as Intl.StringNumericLiteral),
                    })}
                  </span>
                </p>
              </div>
            )}
          </SectionCard>

          <SectionCard title={t('lines.title')} description={t('lines.description')}>
            <div className="@container space-y-3">
              <div
                aria-hidden
                className="hidden gap-x-3 px-3 text-xs font-medium text-muted-foreground @4xl:grid @4xl:grid-cols-[7rem_minmax(0,1fr)_4.5rem_6.5rem_5.5rem_7.5rem_5.5rem_2.25rem]"
              >
                <span>{t('lines.code')}</span>
                <span>{t('lines.name')}</span>
                <span className="text-right">{t('lines.quantity')}</span>
                <span className="text-right">{t('lines.unitPrice')}</span>
                <span className="text-right">{t('lines.discount')}</span>
                <span>{t('lines.iva')}</span>
                <span className="text-right">{t('lines.total')}</span>
              </div>
              <ol aria-label={t('lines.title')} className="space-y-3">
                {lines.map((line, index) => {
                  const amounts = formTotals([line], percents);
                  const hidden = '@4xl:sr-only';
                  return (
                    <li key={line.key}>
                      <div
                        role="group"
                        aria-label={t('lines.line', { number: index + 1 })}
                        className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 @xl:grid-cols-4 @4xl:grid-cols-[7rem_minmax(0,1fr)_4.5rem_6.5rem_5.5rem_7.5rem_5.5rem_2.25rem] @4xl:items-start @4xl:border-0 @4xl:p-0 @4xl:px-3"
                      >
                        <FormField label={t('lines.code')} required labelClassName={hidden}>
                          {(a11y) => (
                            <Combobox
                              a11y={a11y}
                              inputRef={bind(line.key, 'code')}
                              value={line.code}
                              onInputChange={(code) =>
                                updateLine(line.key, { code, productId: null })
                              }
                              options={productOptions(line.code)}
                              onPick={(option) => {
                                const product = products.find((item) => item.id === option.value);
                                if (product) pickProduct(line, product);
                              }}
                              onKeyDown={onLineKey(line, 'code')}
                              emptyText={t('lines.noProducts')}
                              listLabel={t('lines.products')}
                            />
                          )}
                        </FormField>
                        <FormField
                          label={t('lines.name')}
                          required
                          labelClassName={hidden}
                          className="col-span-2 @xl:col-span-3 @4xl:col-span-1"
                        >
                          {(a11y) => (
                            <Input
                              {...a11y}
                              ref={bind(line.key, 'name')}
                              value={line.name}
                              maxLength={300}
                              onChange={(event) =>
                                updateLine(line.key, { name: event.target.value })
                              }
                              onKeyDown={onLineKey(line, 'name')}
                            />
                          )}
                        </FormField>
                        {(['quantity', 'unitPrice', 'discount'] as const).map((field) => (
                          <FormField
                            key={field}
                            label={t(`lines.${field}`)}
                            required={field !== 'discount'}
                            labelClassName={hidden}
                          >
                            {(a11y) => (
                              <Input
                                {...a11y}
                                ref={bind(line.key, field)}
                                value={line[field]}
                                inputMode="decimal"
                                autoComplete="off"
                                placeholder={field === 'discount' ? `0${mark}00` : undefined}
                                className="text-right tabular-nums"
                                onChange={(event) =>
                                  updateLine(line.key, { [field]: event.target.value })
                                }
                                onKeyDown={onLineKey(line, field)}
                              />
                            )}
                          </FormField>
                        ))}
                        <FormField label={t('lines.iva')} labelClassName={hidden}>
                          {(a11y) => (
                            <ChoiceSelect
                              a11y={a11y}
                              value={line.ivaRateCode}
                              onChange={(ivaRateCode) => updateLine(line.key, { ivaRateCode })}
                              options={ivaRates}
                            />
                          )}
                        </FormField>
                        <div className="flex items-center justify-end gap-2 @xl:col-span-3 @4xl:col-span-1 @4xl:block @4xl:pt-2 @4xl:text-right">
                          <span className="text-xs font-medium text-muted-foreground @4xl:sr-only">
                            {t('lines.total')}
                          </span>
                          <output className="text-sm font-semibold tabular-nums">
                            {amounts.incomplete ? '—' : show(amounts.subtotal)}
                          </output>
                        </div>
                        <div className="flex items-center justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={lines.length === 1}
                            aria-label={t('lines.remove', { number: index + 1 })}
                            title={t('lines.remove', { number: index + 1 })}
                            onClick={() => removeLine(index)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                  {t('lines.add')}
                </Button>
                <p className="text-sm 2xl:hidden">
                  <span className="text-muted-foreground">{t('totals.total')} </span>
                  <span className="font-semibold tabular-nums">{show(totals.total)}</span>
                </p>
              </div>
              <p role="status" className="sr-only">
                {announcement}
              </p>
            </div>
          </SectionCard>

          <SectionCard
            title={t('payment.title')}
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setPayments((current) => [
                    ...current.map((payment, index) =>
                      // The first payment keeps the total it showed.
                      index === 0 && current.length === 1
                        ? { ...payment, amount: formatCents(totals.total) }
                        : payment,
                    ),
                    {
                      key: newKey(),
                      method: paymentMethods[0]?.value ?? '01',
                      amount: '',
                      term: '',
                      termUnit: '',
                    },
                  ])
                }
              >
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                {t('payment.add')}
              </Button>
            }
          >
            <ol className="space-y-3">
              {payments.map((payment, index) => (
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
                        onChange={(method) =>
                          setPayments((current) =>
                            current.map((item) =>
                              item.key === payment.key ? { ...item, method } : item,
                            ),
                          )
                        }
                      />
                    )}
                  </FormField>
                  <FormField label={t('payment.amount')}>
                    {(a11y) => (
                      <Input
                        {...a11y}
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        readOnly={single}
                        value={
                          single ? formatCents(totals.total).replace('.', mark) : payment.amount
                        }
                        onChange={(event) =>
                          setPayments((current) =>
                            current.map((item) =>
                              item.key === payment.key
                                ? { ...item, amount: event.target.value }
                                : item,
                            ),
                          )
                        }
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
                        onChange={(event) =>
                          setPayments((current) =>
                            current.map((item) =>
                              item.key === payment.key
                                ? { ...item, term: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    )}
                  </FormField>
                  <FormField label={t('payment.termUnit')}>
                    {(a11y) => (
                      <ChoiceSelect
                        a11y={a11y}
                        value={payment.termUnit || termUnits[0]?.value || 'dias'}
                        options={termUnits}
                        onChange={(termUnit) =>
                          setPayments((current) =>
                            current.map((item) =>
                              item.key === payment.key ? { ...item, termUnit } : item,
                            ),
                          )
                        }
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
                      setPayments((current) => current.filter((item) => item.key !== payment.key))
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ol>
            {!single && (
              <p
                role="status"
                className={cn('mt-3 text-sm', difference === 0n ? 'text-success' : 'text-warning')}
              >
                {difference === 0n
                  ? t('payment.matched')
                  : difference > 0n
                    ? t('payment.remaining', { amount: show(difference) })
                    : t('payment.over', { amount: show(-difference) })}
              </p>
            )}
          </SectionCard>

          <SectionCard
            title={t('additional.title')}
            description={t('additional.description')}
            action={
              fields.length < 10 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setFields((current) => [...current, { key: newKey(), name: '', value: '' }])
                  }
                >
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                  {t('additional.add')}
                </Button>
              )
            }
          >
            {fields.length > 0 && (
              <ol className="space-y-3">
                {fields.map((field, index) => (
                  <li
                    key={field.key}
                    className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_2.25rem] sm:items-end"
                  >
                    {(['name', 'value'] as const).map((part) => (
                      <FormField key={part} label={t(`additional.${part}`)}>
                        {(a11y) => (
                          <Input
                            {...a11y}
                            maxLength={300}
                            value={field[part]}
                            onChange={(event) =>
                              setFields((current) =>
                                current.map((item) =>
                                  item.key === field.key
                                    ? { ...item, [part]: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        )}
                      </FormField>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('additional.remove', { number: index + 1 })}
                      title={t('additional.remove', { number: index + 1 })}
                      onClick={() =>
                        setFields((current) => current.filter((item) => item.key !== field.key))
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </div>

        {/* The receipt: stays in view while the lines grow. */}
        <aside aria-labelledby="invoice-totals" className="2xl:sticky 2xl:top-6">
          <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 id="invoice-totals" className="text-sm font-semibold">
              {t('totals.title')}
            </h2>
            <dl className="mt-4 space-y-2 text-sm">
              {totals.groups.map((group) => (
                <div key={`base-${group.rateCode}`} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">
                    {t('totals.subtotal', { rate: rateLabel(group.rateCode) })}
                  </dt>
                  <dd className="tabular-nums">{show(group.base)}</dd>
                </div>
              ))}
              {totals.discount > 0n && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t('totals.discount')}</dt>
                  <dd className="tabular-nums">{show(totals.discount)}</dd>
                </div>
              )}
              {totals.groups
                .filter((group) => group.iva > 0n)
                .map((group) => (
                  <div key={`iva-${group.rateCode}`} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{rateLabel(group.rateCode)}</dt>
                    <dd className="tabular-nums">{show(group.iva)}</dd>
                  </div>
                ))}
            </dl>
            <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-border pt-4">
              <span className="text-sm font-medium">{t('totals.total')}</span>
              <output
                aria-live="polite"
                className="text-2xl font-semibold tracking-tight tabular-nums"
              >
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
        <Button type="submit" disabled={pending || !canIssue}>
          <Send className="mr-1.5 h-4 w-4" aria-hidden />
          {copy.submit}
        </Button>
      </FormActionBar>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          setConfirming(open);
          if (!open) setError(undefined);
        }}
        title={copy.confirmTitle}
        description={copy.confirmDescription}
        detail={t('confirmDetail', {
          buyer: client?.name ?? t('buyer.consumerFinal'),
          total: show(totals.total),
        })}
        confirmLabel={copy.submit}
        pending={pending}
        error={error}
        onConfirm={issue}
      />
    </form>
  );
}
