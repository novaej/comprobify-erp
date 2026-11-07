'use client';

import { Button, buttonVariants } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Textarea } from '@comprobify/ui/components/textarea';
import { AlertCircle, PackageCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Banner } from '@/components/banner';
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
import { ToneBadge } from '@/components/tone-badge';
import { Link } from '@/i18n/navigation';
import { normalizeDecimal, parseDecimal } from '@/lib/invoice-totals';
import { receiveAction } from '../../actions';

export type ReceiveLine = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  // Decimal strings with a point, as stored.
  ordered: string;
  received: string;
  left: string;
  stocked: boolean;
};

const shown = (value: string, mark: string) =>
  value.includes('.') ? value.replace(/\.?0+$/, '').replace('.', mark) : value;

// FR-PUR-2: how much of each line arrived now; every line starts at what is left.
export function ReceiveForm({
  orderId,
  number,
  lines,
}: {
  orderId: string;
  number: string;
  lines: ReceiveLine[];
}) {
  const t = useTranslations('purchaseOrders.receive');
  const tError = useTranslations('purchaseOrdersError');
  const locale = useLocale();
  const mark = locale === 'en' ? '.' : ',';
  const open = lines.filter((line) => parseDecimal(line.left)! > 0n);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map((line) => [line.id, shown(line.left, mark)])),
  );
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  // Each typed quantity is a decimal no larger than what is left; empty or 0 skips the line.
  const parsed = open.map((line) => {
    const value = quantities[line.id]?.trim() ?? '';
    const amount = value === '' ? 0n : parseDecimal(value);
    const valid = amount !== null && amount <= parseDecimal(line.left)!;
    return { line, value, amount: amount ?? 0n, valid };
  });
  const chosen = parsed.filter((item) => item.valid && item.amount > 0n);
  const ready = parsed.every((item) => item.valid) && chosen.length > 0;
  const setAll = (fill: boolean) =>
    setQuantities(
      Object.fromEntries(open.map((line) => [line.id, fill ? shown(line.left, mark) : ''])),
    );
  const submit = () => {
    const form = new FormData();
    form.set('locale', locale);
    form.set(
      'payload',
      JSON.stringify({
        orderId,
        lines: chosen.map((item) => ({
          lineId: item.line.id,
          quantity: normalizeDecimal(item.value),
        })),
        notes: notes.trim() || null,
      }),
    );
    startTransition(async () => {
      // Success redirects to the order; only a refusal comes back.
      const state = await receiveAction({}, form);
      if (state?.error) {
        setConfirming(false);
        setError(tError.has(state.error) ? tError(state.error) : tError('UNKNOWN'));
      }
    });
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(undefined);
        if (ready) setConfirming(true);
        else setError(t('nothing'));
      }}
      className="space-y-6"
    >
      <section aria-labelledby="receive-lines" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="receive-lines" className="text-sm font-semibold">
            {t('linesTitle')}
          </h2>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAll(true)}>
              {t('all')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setAll(false)}>
              {t('none')}
            </Button>
          </div>
        </div>
        <TableCard>
          <StackTable aria-labelledby="receive-lines">
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('product')}</StackHead>
                <StackHead className="text-right">{t('ordered')}</StackHead>
                <StackHead className="text-right">{t('received')}</StackHead>
                <StackHead className="text-right">{t('left')}</StackHead>
                <StackHead className="pr-4 text-right">{t('now')}</StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {parsed.map(({ line, valid }) => (
                <StackRow key={line.id}>
                  <StackCell heading className="pl-4">
                    <p className="font-medium">{line.name}</p>
                    <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                      {line.code}
                      {!line.stocked && <ToneBadge tone="neutral">{t('noStock')}</ToneBadge>}
                    </p>
                  </StackCell>
                  <StackCell label={t('ordered')} className="text-right tabular-nums">
                    {shown(line.ordered, mark)}
                    {line.unit && (
                      <span className="ml-1 text-xs text-muted-foreground">{line.unit}</span>
                    )}
                  </StackCell>
                  <StackCell label={t('received')} className="text-right tabular-nums">
                    {shown(line.received, mark)}
                  </StackCell>
                  <StackCell label={t('left')} className="text-right tabular-nums">
                    {shown(line.left, mark)}
                  </StackCell>
                  <StackCell label={t('now')} className="pr-4 sm:w-36">
                    <Input
                      aria-label={t('nowFor', { name: line.name })}
                      aria-invalid={!valid || undefined}
                      inputMode="decimal"
                      autoComplete="off"
                      className="text-right tabular-nums"
                      value={quantities[line.id] ?? ''}
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [line.id]: event.target.value,
                        }))
                      }
                    />
                  </StackCell>
                </StackRow>
              ))}
            </StackBody>
          </StackTable>
        </TableCard>
        {open.some((line) => !line.stocked) && (
          <p className="text-xs text-muted-foreground">{t('noStockHint')}</p>
        )}
      </section>

      <SectionCard title={t('notes')}>
        <FormField label={t('notes')} labelClassName="sr-only" hint={t('notesHint')}>
          {(a11y) => (
            <Textarea
              {...a11y}
              value={notes}
              maxLength={300}
              rows={2}
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </FormField>
      </SectionCard>

      {error && (
        <Banner tone="danger" icon={AlertCircle} role="alert" className="mb-0">
          {error}
        </Banner>
      )}
      <FormActionBar>
        <Link href={`/purchase-orders/${orderId}`} className={buttonVariants({ variant: 'ghost' })}>
          {t('cancel')}
        </Link>
        <Button type="submit" disabled={pending}>
          <PackageCheck className="mr-1.5 h-4 w-4" aria-hidden />
          {t('submit')}
        </Button>
      </FormActionBar>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('confirmTitle')}
        description={t('confirmDescription')}
        detail={number}
        confirmLabel={t('submit')}
        pending={pending}
        onConfirm={submit}
      />
    </form>
  );
}
