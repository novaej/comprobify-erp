'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Switch } from '@comprobify/ui/components/switch';
import { Plus, Send, Tag, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { useServerAction } from '@/components/use-server-action';
import { discardPriceAction, draftPriceAction, publishPriceAction } from './actions';

// What a row of the price book is for, as the forms send it.
export type PriceTarget = {
  kind: 'PLAN' | 'MODULE' | 'SEAT' | 'PACK';
  key: string | null;
  packSize: number | null;
  name: string;
};

const targetFields = (target: PriceTarget) => ({
  kind: target.kind,
  ...(target.key ? { key: target.key } : {}),
  ...(target.packSize ? { packSize: String(target.packSize) } : {}),
});

function AmountField({ defaultValue, hint }: { defaultValue?: string; hint: string }) {
  const t = useTranslations('prices');
  return (
    <FormField label={t('amount')} hint={hint} required>
      {(a11y) => (
        <Input
          {...a11y}
          name="amount"
          inputMode="decimal"
          defaultValue={defaultValue}
          className="text-right tabular-nums"
          required
        />
      )}
    </FormField>
  );
}

// A new draft for the row, or a change to the one it has. Nothing reaches a company until it
// is published.
export function DraftPriceButton({
  target,
  amount,
}: {
  target: PriceTarget;
  amount: string | null;
}) {
  const t = useTranslations('prices');
  const [open, setOpen] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Tag className="mr-1.5 h-4 w-4" aria-hidden />
        {t('change')}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('changeTitle', { name: target.name })}
        description={t('changeDescription')}
        submitLabel={t('saveDraft')}
        action={draftPriceAction}
        errors="pricesError"
        success={t('drafted')}
        extra={{ ...targetFields(target), ...(withdraw ? { withdraw: 'on' } : {}) }}
      >
        {!withdraw && (
          <AmountField
            defaultValue={amount ?? undefined}
            hint={target.kind === 'PACK' ? t('onceHint') : t('monthlyHint')}
          />
        )}
        {target.kind === 'PACK' && (
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{t('withdraw')}</span>
            <Switch checked={withdraw} onCheckedChange={setWithdraw} aria-label={t('withdraw')} />
          </label>
        )}
      </FormDialog>
    </>
  );
}

// Publishing dates the draft: today when nobody needs notice, otherwise 30 days on at the
// earliest. Core works it out and refuses an earlier date.
export function PublishPriceButton({
  id,
  name,
  amount,
  today,
}: {
  id: string;
  name: string;
  amount: string;
  today: string;
}) {
  const t = useTranslations('prices');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Send className="mr-1.5 h-4 w-4" aria-hidden />
        {t('publish')}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('publishTitle', { name })}
        description={t('publishDescription', { amount })}
        submitLabel={t('publish')}
        action={publishPriceAction}
        errors="pricesError"
        success={t('published')}
        extra={{ id }}
      >
        <FormField label={t('effectiveOn')} hint={t('effectiveOnHint')}>
          {(a11y) => <Input {...a11y} name="effectiveOn" type="date" min={today} />}
        </FormField>
      </FormDialog>
    </>
  );
}

export function DiscardPriceButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations('prices');
  const [open, setOpen] = useState(false);
  const discard = useServerAction(discardPriceAction, {
    errors: 'pricesError',
    success: t('discarded'),
    onDone: () => setOpen(false),
  });
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
        {t('discard')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) discard.clearError();
        }}
        title={t('discardTitle')}
        description={t('discardDescription')}
        detail={name}
        confirmLabel={t('discard')}
        destructive
        pending={discard.pending}
        error={discard.error}
        onConfirm={() => discard.run({ id })}
      />
    </>
  );
}

// A pack size not sold before: a draft like any other, published from its row.
export function NewPackButton() {
  const t = useTranslations('prices');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" aria-hidden />
        {t('newPack')}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('newPack')}
        description={t('newPackDescription')}
        submitLabel={t('saveDraft')}
        action={draftPriceAction}
        errors="pricesError"
        success={t('drafted')}
        extra={{ kind: 'PACK' }}
      >
        <FormField label={t('packSize')} required>
          {(a11y) => (
            <Input
              {...a11y}
              name="packSize"
              inputMode="numeric"
              className="text-right tabular-nums"
              required
            />
          )}
        </FormField>
        <AmountField hint={t('onceHint')} />
      </FormDialog>
    </>
  );
}
