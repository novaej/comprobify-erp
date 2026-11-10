'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { AlertCircle, Layers, ShoppingCart } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { Banner } from '@/components/banner';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
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
import { startBatchAction } from '../actions';

export type OrderOption = {
  id: string;
  number: string;
  date: string;
  client: string;
  total: string;
};

// FR-BULK-1: the orders ticked on this page, or all that match the search, one invoice each.
export function BatchForm({
  orders,
  matching,
  query,
  issuePoints,
  paymentMethods,
  termUnits,
}: {
  orders: OrderOption[];
  // Every invoiceable order matching the search, over all pages.
  matching: number;
  query: string;
  issuePoints: Choice[];
  paymentMethods: Choice[];
  termUnits: Choice[];
}) {
  const t = useTranslations('bulkInvoicing');
  const tError = useTranslations('bulkInvoicingError');
  const tDocError = useTranslations('documentsError');
  const locale = useLocale();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issuePointId, setIssuePointId] = useState(issuePoints[0]?.value ?? '');
  const [method, setMethod] = useState(paymentMethods[0]?.value ?? '01');
  const [term, setTerm] = useState('');
  const [termUnit, setTermUnit] = useState(termUnits[0]?.value ?? 'dias');
  const [asking, setAsking] = useState<'selected' | 'all' | null>(null);
  const [error, setError] = useState<string>();

  const allOnPage = orders.length > 0 && orders.every((order) => selected.has(order.id));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allOnPage ? new Set() : new Set(orders.map((order) => order.id)));
  const termInvalid = term.trim() !== '' && !/^\d{1,4}$/.test(term.trim());
  const ready = issuePointId !== '' && !termInvalid;
  const count = asking === 'all' ? matching : selected.size;

  const send = () => {
    const form = new FormData();
    form.set('locale', locale);
    form.set('issuePointId', issuePointId);
    form.set('method', method);
    form.set('term', term.trim());
    form.set('termUnit', termUnit);
    if (asking === 'all') {
      form.set('scope', 'all');
      form.set('q', query);
    } else form.set('orderIds', JSON.stringify([...selected]));
    startTransition(async () => {
      // Success redirects to the batch; only a refusal comes back.
      const state = await startBatchAction({}, form);
      if (state?.error)
        setError(
          tError.has(state.error)
            ? tError(state.error)
            : tDocError.has(state.error)
              ? tDocError(state.error)
              : tError('UNKNOWN'),
        );
    });
  };

  if (orders.length === 0)
    return (
      <TableCard>
        <EmptyState
          icon={ShoppingCart}
          title={query ? t('noMatchesTitle') : t('noOrdersTitle')}
          description={query ? t('noMatches') : t('noOrders')}
        />
      </TableCard>
    );

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(undefined);
        if (ready && selected.size > 0) setAsking('selected');
      }}
      className="space-y-6"
    >
      <SectionCard title={t('form.title')} description={t('form.description')}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem_8rem]">
          <FormField label={t('form.issuePoint')} required>
            {(a11y) => (
              <ChoiceSelect
                a11y={a11y}
                value={issuePointId}
                onChange={setIssuePointId}
                options={issuePoints}
              />
            )}
          </FormField>
          <FormField label={t('form.method')}>
            {(a11y) => (
              <ChoiceSelect
                a11y={a11y}
                value={method}
                onChange={setMethod}
                options={paymentMethods}
              />
            )}
          </FormField>
          <FormField label={t('form.term')} error={termInvalid ? t('form.termInvalid') : undefined}>
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
          <FormField label={t('form.termUnit')}>
            {(a11y) => (
              <ChoiceSelect
                a11y={a11y}
                value={termUnit}
                onChange={setTermUnit}
                options={termUnits}
                disabled={term.trim() === ''}
              />
            )}
          </FormField>
        </div>
      </SectionCard>

      <section aria-labelledby={`${uid}-orders`}>
        <h2 id={`${uid}-orders`} className="mb-2 text-sm font-semibold">
          {t('orders.title', { matching })}
        </h2>
        <TableCard>
          <StackTable aria-label={t('orders.title', { matching })}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="w-10 pl-4">
                  <input
                    type="checkbox"
                    checked={allOnPage}
                    onChange={toggleAll}
                    aria-label={t('orders.selectPage')}
                    className="h-4 w-4 accent-primary"
                  />
                </StackHead>
                <StackHead>{t('orders.number')}</StackHead>
                <StackHead>{t('orders.date')}</StackHead>
                <StackHead>{t('orders.client')}</StackHead>
                <StackHead className="pr-4 text-right">{t('orders.total')}</StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {orders.map((order) => (
                <StackRow key={order.id}>
                  <StackCell className="pl-4">
                    <input
                      type="checkbox"
                      checked={selected.has(order.id)}
                      onChange={() => toggle(order.id)}
                      aria-label={t('orders.select', { number: order.number })}
                      className="h-4 w-4 accent-primary"
                    />
                  </StackCell>
                  <StackCell heading className="font-medium tabular-nums">
                    {order.number}
                  </StackCell>
                  <StackCell label={t('orders.date')} className="tabular-nums">
                    {order.date}
                  </StackCell>
                  <StackCell label={t('orders.client')}>
                    <p className="break-words">{order.client}</p>
                  </StackCell>
                  <StackCell label={t('orders.total')} className="pr-4 text-right tabular-nums">
                    {order.total}
                  </StackCell>
                </StackRow>
              ))}
            </StackBody>
          </StackTable>
        </TableCard>
      </section>

      {error && !asking && (
        <Banner tone="danger" icon={AlertCircle} role="alert" className="mb-0">
          {error}
        </Banner>
      )}
      <FormActionBar summary={t('selected', { count: selected.size })}>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !ready || matching === 0}
          onClick={() => {
            setError(undefined);
            setAsking('all');
          }}
        >
          <Layers className="mr-1.5 h-4 w-4" aria-hidden />
          {t('submitAll', { count: matching })}
        </Button>
        <Button type="submit" disabled={pending || !ready || selected.size === 0}>
          <Layers className="mr-1.5 h-4 w-4" aria-hidden />
          {t('submit', { count: selected.size })}
        </Button>
      </FormActionBar>

      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAsking(null);
            setError(undefined);
          }
        }}
        title={t('confirm.title')}
        description={t('confirm.description')}
        detail={t('confirm.detail', { count })}
        confirmLabel={t('confirm.submit', { count })}
        pending={pending}
        error={error}
        onConfirm={send}
      />
    </form>
  );
}
