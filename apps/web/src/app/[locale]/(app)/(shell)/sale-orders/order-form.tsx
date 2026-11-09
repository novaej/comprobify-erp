'use client';

import { Button, buttonVariants } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Textarea } from '@comprobify/ui/components/textarea';
import { AlertCircle, Plus, Save, Trash2, UserRound, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { Banner } from '@/components/banner';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { Combobox, type ComboOption } from '@/components/combobox';
import { FormActionBar } from '@/components/form-action-bar';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import { Link } from '@/i18n/navigation';
import { formatCents, formTotals, normalizeDecimal } from '@/lib/invoice-totals';
import { saveSaleOrderAction } from './actions';

export type OrderProductOption = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  price: string;
  ivaRateCode: string;
  ivaPercent: string;
  ivaLabel: string;
};

export type OrderClientOption = {
  id: string;
  name: string;
  identification: string;
  idTypeLabel: string;
};

// An order being edited, as last saved.
export type OrderDraft = {
  id: string;
  number: string;
  clientId: string | null;
  warehouseId: string;
  notes: string | null;
  lines: { productId: string; quantity: string; unitPrice: string; discount: string }[];
};

type Line = {
  key: string;
  productId: string | null;
  query: string;
  quantity: string;
  unitPrice: string;
  discount: string;
};

// The order Enter walks through a line (FR-UX-4).
const LINE_FIELDS = ['product', 'quantity', 'unitPrice', 'discount'] as const;
type LineField = (typeof LINE_FIELDS)[number];

const newKey = () => crypto.randomUUID();
const matches = (text: string, query: string) =>
  text.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es'));
// Stored decimals as typed: no trailing zeros, the locale's mark.
const typed = (value: string, mark: string) =>
  value.includes('.') ? value.replace(/\.?0+$/, '').replace('.', mark) : value;

// FR-SAL-1: a client (or consumidor final), where the goods come from, and what is ordered at
// what price.
export function OrderForm({
  clients,
  products,
  warehouses,
  draft,
}: {
  clients: OrderClientOption[];
  products: OrderProductOption[];
  warehouses: Choice[];
  draft?: OrderDraft;
}) {
  const t = useTranslations('saleOrders.form');
  const tError = useTranslations('saleOrdersError');
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
  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const percents = useMemo(
    () => new Map(products.map((product) => [product.ivaRateCode, product.ivaPercent])),
    [products],
  );
  const label = (product: OrderProductOption) => `${product.code} · ${product.name}`;
  const blankLine = (): Line => ({
    key: newKey(),
    productId: null,
    query: '',
    quantity: '1',
    unitPrice: '',
    discount: '',
  });

  const [client, setClient] = useState<OrderClientOption | null>(
    () => clients.find((option) => option.id === draft?.clientId) ?? null,
  );
  const [clientQuery, setClientQuery] = useState('');
  const [warehouseId, setWarehouseId] = useState(draft?.warehouseId ?? warehouses[0]?.value ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    draft && draft.lines.length > 0
      ? draft.lines.map((line) => {
          const product = byId.get(line.productId);
          return {
            key: newKey(),
            // A product made inactive since stays named, and core refuses it on save.
            productId: product ? line.productId : null,
            query: product ? label(product) : '',
            quantity: typed(line.quantity, mark),
            unitPrice: typed(line.unitPrice, mark),
            discount: Number(line.discount) > 0 ? typed(line.discount, mark) : '',
          };
        })
      : [blankLine()],
  );
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const focusTarget = useRef<string | null>(null);
  const bind = (line: string, field: LineField) => (element: HTMLInputElement | null) => {
    if (element) inputs.current.set(`${line}:${field}`, element);
    else inputs.current.delete(`${line}:${field}`);
  };
  const moveTo = (element: HTMLInputElement | undefined) => {
    element?.focus();
    element?.select();
  };
  useEffect(() => {
    if (focusTarget.current) moveTo(inputs.current.get(focusTarget.current));
    focusTarget.current = null;
  });

  // The invoice's exact arithmetic (ADR-012), so the order's total is the invoice's.
  const totalsLines = (source: Line[]) =>
    source.map((line) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      ivaRateCode: (line.productId && byId.get(line.productId)?.ivaRateCode) || '',
    }));
  const totals = formTotals(totalsLines(lines), percents);
  const updateLine = (key: string, change: Partial<Line>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );
  const addLine = () => {
    const line = blankLine();
    setLines((current) => [...current, line]);
    focusTarget.current = `${line.key}:product`;
    setAnnouncement(t('lines.added', { number: lines.length + 1 }));
  };
  const removeLine = (index: number) => {
    setLines((current) => current.filter((_, i) => i !== index));
    const neighbour = lines[index + 1] ?? lines[index - 1];
    if (neighbour) focusTarget.current = `${neighbour.key}:product`;
    setAnnouncement(t('lines.removed', { number: index + 1 }));
  };
  const pickProduct = (line: Line, product: OrderProductOption) => {
    updateLine(line.key, {
      productId: product.id,
      query: label(product),
      // The catalogue's price, which the line may change.
      unitPrice: line.unitPrice || typed(product.price, mark),
    });
    focusTarget.current = `${line.key}:quantity`;
  };
  const onLineKey = (line: Line, field: LineField) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const next = LINE_FIELDS[LINE_FIELDS.indexOf(field) + 1];
    if (next) moveTo(inputs.current.get(`${line.key}:${next}`));
    else if (lines.at(-1)?.key === line.key) addLine();
    else {
      const following = lines[lines.findIndex((item) => item.key === line.key) + 1];
      if (following) moveTo(inputs.current.get(`${following.key}:product`));
    }
  };
  const productOptions = (query: string): ComboOption[] =>
    products
      .filter((product) => matches(product.code, query) || matches(product.name, query))
      .slice(0, 8)
      .map((product) => ({
        value: product.id,
        label: product.name,
        detail: `${product.code}, ${product.ivaLabel}`,
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

  const complete =
    warehouseId !== '' &&
    lines.length > 0 &&
    lines.every((line) => line.productId) &&
    !totals.incomplete;
  const save = () => {
    const form = new FormData();
    form.set('locale', locale);
    if (draft) form.set('id', draft.id);
    form.set(
      'payload',
      JSON.stringify({
        clientId: client?.id ?? null,
        warehouseId,
        notes: notes.trim() || null,
        lines: lines.map((line) => ({
          productId: line.productId,
          quantity: normalizeDecimal(line.quantity),
          unitPrice: normalizeDecimal(line.unitPrice),
          discount: normalizeDecimal(line.discount) || '0',
        })),
      }),
    );
    startTransition(async () => {
      // Success redirects to the order; only a refusal comes back.
      const state = await saveSaleOrderAction({}, form);
      if (state?.error) setError(tError.has(state.error) ? tError(state.error) : tError('UNKNOWN'));
    });
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(undefined);
        if (complete) save();
        else setError(t('incomplete'));
      }}
    >
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-6">
          <SectionCard
            title={t('client.title')}
            description={t('client.description')}
            action={
              client && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setClient(null);
                    setClientQuery('');
                  }}
                >
                  <X className="mr-1.5 h-4 w-4" aria-hidden />
                  {t('client.change')}
                </Button>
              )
            }
          >
            {client ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="font-medium">{client.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {client.idTypeLabel} {client.identification}
                </span>
              </p>
            ) : (
              <div className="space-y-2">
                <Combobox
                  label={t('client.search')}
                  placeholder={t('client.search')}
                  value={clientQuery}
                  onInputChange={setClientQuery}
                  options={clientOptions}
                  emptyText={t('client.none')}
                  listLabel={t('client.list')}
                  onPick={(option) =>
                    setClient(clients.find((item) => item.id === option.value) ?? null)
                  }
                />
                <p className="text-xs text-muted-foreground">{t('client.finalConsumer')}</p>
              </div>
            )}
          </SectionCard>

          <SectionCard title={t('delivery.title')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('delivery.warehouse')} required>
                {(a11y) => (
                  <ChoiceSelect
                    a11y={a11y}
                    value={warehouseId}
                    onChange={setWarehouseId}
                    options={warehouses}
                    disabled={warehouses.length < 2}
                  />
                )}
              </FormField>
              <FormField
                label={t('delivery.notes')}
                hint={t('delivery.notesHint')}
                className="sm:col-span-2"
              >
                {(a11y) => (
                  <Textarea
                    {...a11y}
                    value={notes}
                    maxLength={1000}
                    rows={2}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                )}
              </FormField>
            </div>
          </SectionCard>

          <SectionCard title={t('lines.title')} description={t('lines.description')}>
            <div className="@container space-y-3">
              <div
                aria-hidden
                className="hidden gap-x-3 px-3 text-xs font-medium text-muted-foreground @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_6rem_7rem_6rem_5.5rem_6.5rem_2.25rem]"
              >
                <span>{t('lines.product')}</span>
                <span className="text-right">{t('lines.quantity')}</span>
                <span className="text-right">{t('lines.unitPrice')}</span>
                <span className="text-right">{t('lines.discount')}</span>
                <span>{t('lines.iva')}</span>
                <span className="text-right">{t('lines.total')}</span>
              </div>
              <ol aria-label={t('lines.title')} className="space-y-3">
                {lines.map((line, index) => {
                  const product = line.productId ? byId.get(line.productId) : undefined;
                  const amounts = formTotals(totalsLines([line]), percents);
                  const hidden = '@3xl:sr-only';
                  return (
                    <li key={line.key}>
                      <div
                        role="group"
                        aria-label={t('lines.line', { number: index + 1 })}
                        className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 @xl:grid-cols-4 @3xl:grid-cols-[minmax(0,1fr)_6rem_7rem_6rem_5.5rem_6.5rem_2.25rem] @3xl:items-start @3xl:border-0 @3xl:p-0 @3xl:px-3"
                      >
                        <FormField
                          label={t('lines.product')}
                          required
                          labelClassName={hidden}
                          className="col-span-2 @xl:col-span-4 @3xl:col-span-1"
                        >
                          {(a11y) => (
                            <Combobox
                              a11y={a11y}
                              inputRef={bind(line.key, 'product')}
                              placeholder={t('lines.pick')}
                              value={line.query}
                              onInputChange={(query) =>
                                updateLine(line.key, { query, productId: null })
                              }
                              options={productOptions(line.query)}
                              onPick={(option) => {
                                const picked = byId.get(option.value);
                                if (picked) pickProduct(line, picked);
                              }}
                              onKeyDown={onLineKey(line, 'product')}
                              emptyText={t('lines.noProducts')}
                              listLabel={t('lines.products')}
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
                                className="text-right tabular-nums"
                                onChange={(event) =>
                                  updateLine(line.key, { [field]: event.target.value })
                                }
                                onKeyDown={onLineKey(line, field)}
                              />
                            )}
                          </FormField>
                        ))}
                        <div className="flex items-center justify-between gap-2 @3xl:block @3xl:pt-2">
                          <span className="text-xs font-medium text-muted-foreground @3xl:sr-only">
                            {t('lines.iva')}
                          </span>
                          <span className="text-sm">{product?.ivaLabel ?? '—'}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 @3xl:block @3xl:pt-2 @3xl:text-right">
                          <span className="text-xs font-medium text-muted-foreground @3xl:sr-only">
                            {t('lines.total')}
                          </span>
                          <output className="text-sm font-semibold tabular-nums">
                            {amounts.incomplete ? '—' : show(amounts.subtotal)}
                          </output>
                        </div>
                        <div className="col-span-2 flex items-center justify-end @xl:col-span-1 @3xl:col-span-1">
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
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                {t('lines.add')}
              </Button>
              <p role="status" className="sr-only">
                {announcement}
              </p>
            </div>
          </SectionCard>
        </div>

        <SectionCard title={t('totals.title')} className="xl:sticky xl:top-6">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('totals.subtotal')}</dt>
              <dd className="tabular-nums">{show(totals.subtotal)}</dd>
            </div>
            {totals.groups.map((group) => (
              <div key={group.rateCode} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  {/* The rate's label already says IVA, such as "IVA 15%". */}
                  {products.find((p) => p.ivaRateCode === group.rateCode)?.ivaLabel ??
                    t('totals.iva')}
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
        <Link
          href={draft ? `/sale-orders/${draft.id}` : '/sale-orders'}
          className={buttonVariants({ variant: 'ghost' })}
        >
          {t('cancel')}
        </Link>
        <Button type="submit" disabled={pending}>
          <Save className="mr-1.5 h-4 w-4" aria-hidden />
          {draft ? t('save') : t('create')}
        </Button>
      </FormActionBar>
    </form>
  );
}
