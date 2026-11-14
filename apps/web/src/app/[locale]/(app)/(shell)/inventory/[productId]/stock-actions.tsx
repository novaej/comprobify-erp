'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Textarea } from '@comprobify/ui/components/textarea';
import { PackageOpen, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChoiceSelect } from '@/components/choice-select';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { adjustStockAction, openingBalanceAction } from '../actions';

export type WarehouseChoice = {
  value: string;
  label: string;
  // An opening balance goes only where nothing has moved yet.
  moved: boolean;
  averageCost: string;
};

const DECIMAL = '\\d{1,12}([.,]\\d{1,6})?';

// FR-INV-3: an adjustment with its reason, and an opening balance where stock hasn't moved.
export function StockActions({
  productId,
  warehouses,
  defaultWarehouseId,
}: {
  productId: string;
  warehouses: WarehouseChoice[];
  defaultWarehouseId?: string;
}) {
  const t = useTranslations('inventory.actions');
  const [open, setOpen] = useState<'adjust' | 'opening' | null>(null);
  const fresh = warehouses.filter((warehouse) => !warehouse.moved);
  const initial =
    warehouses.find((warehouse) => warehouse.value === defaultWarehouseId)?.value ??
    warehouses[0]?.value ??
    '';
  const [warehouseId, setWarehouseId] = useState(initial);
  const [chosenOpening, setOpeningWarehouseId] = useState(fresh[0]?.value ?? '');
  // The choice can go stale once a warehouse has its balance (it has moved, so it is no longer
  // offered): fall back to the first one that has not.
  const openingWarehouseId = fresh.some((warehouse) => warehouse.value === chosenOpening)
    ? chosenOpening
    : (fresh[0]?.value ?? '');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const average = warehouses.find((warehouse) => warehouse.value === warehouseId)?.averageCost;

  return (
    <>
      {fresh.length > 0 && (
        <Button size="sm" variant="outline" onClick={() => setOpen('opening')}>
          <PackageOpen className="mr-1.5 h-4 w-4" aria-hidden />
          {t('opening')}
        </Button>
      )}
      <Button size="sm" onClick={() => setOpen('adjust')}>
        <SlidersHorizontal className="mr-1.5 h-4 w-4" aria-hidden />
        {t('adjust')}
      </Button>

      <FormDialog
        open={open === 'adjust'}
        onOpenChange={(next) => setOpen(next ? 'adjust' : null)}
        title={t('adjustTitle')}
        description={t('adjustDescription')}
        submitLabel={t('adjustSubmit')}
        action={adjustStockAction}
        errors="inventoryError"
        success={t('adjusted')}
        extra={{ productId, warehouseId, direction }}
      >
        {warehouses.length > 1 && (
          <FormField label={t('warehouse')} required>
            {(a11y) => (
              <ChoiceSelect
                a11y={a11y}
                value={warehouseId}
                onChange={setWarehouseId}
                options={warehouses}
              />
            )}
          </FormField>
        )}
        <FormField label={t('direction')} required>
          {(a11y) => (
            <ChoiceSelect
              a11y={a11y}
              value={direction}
              onChange={(next) => setDirection(next as 'IN' | 'OUT')}
              options={[
                { value: 'IN', label: t('directions.IN') },
                { value: 'OUT', label: t('directions.OUT') },
              ]}
            />
          )}
        </FormField>
        <FormField label={t('quantity')} required>
          {(a11y) => (
            <Input
              {...a11y}
              name="quantity"
              inputMode="decimal"
              pattern={DECIMAL}
              required
              autoFocus
            />
          )}
        </FormField>
        {direction === 'IN' ? (
          <FormField label={t('unitCost')} hint={t('unitCostHint', { cost: average ?? '0' })}>
            {(a11y) => <Input {...a11y} name="unitCost" inputMode="decimal" pattern={DECIMAL} />}
          </FormField>
        ) : (
          <p className="text-xs text-muted-foreground">{t('outAtAverage')}</p>
        )}
        <FormField label={t('reason')} hint={t('reasonHint')} required>
          {(a11y) => <Textarea {...a11y} name="reason" maxLength={300} required />}
        </FormField>
      </FormDialog>

      <FormDialog
        open={open === 'opening'}
        onOpenChange={(next) => setOpen(next ? 'opening' : null)}
        title={t('openingTitle')}
        description={t('openingDescription')}
        submitLabel={t('openingSubmit')}
        action={openingBalanceAction}
        errors="inventoryError"
        success={t('openingDone')}
        extra={{ productId, warehouseId: openingWarehouseId }}
      >
        {warehouses.length > 1 && (
          <FormField label={t('warehouse')} required>
            {(a11y) => (
              <ChoiceSelect
                a11y={a11y}
                value={openingWarehouseId}
                onChange={setOpeningWarehouseId}
                options={fresh}
              />
            )}
          </FormField>
        )}
        <FormField label={t('quantity')} required>
          {(a11y) => (
            <Input
              {...a11y}
              name="quantity"
              inputMode="decimal"
              pattern={DECIMAL}
              required
              autoFocus
            />
          )}
        </FormField>
        <FormField label={t('unitCost')} required>
          {(a11y) => (
            <Input {...a11y} name="unitCost" inputMode="decimal" pattern={DECIMAL} required />
          )}
        </FormField>
      </FormDialog>
    </>
  );
}
