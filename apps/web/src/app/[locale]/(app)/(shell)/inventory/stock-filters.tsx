'use client';

import { Input } from '@comprobify/ui/components/input';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { FormField } from '@/components/form-field';
import { useLiveFilters } from '@/components/use-live-filters';
import { Link } from '@/i18n/navigation';

const ALL = 'all';

// A GET form, as the document list's: the filters live in the URL.
export function StockFilters({
  warehouses,
  values,
}: {
  warehouses: Choice[];
  values: { warehouseId?: string; q?: string };
}) {
  const t = useTranslations('inventory');
  const [warehouse, setWarehouse] = useState(values.warehouseId ?? ALL);
  const filtered = Object.values(values).some(Boolean);
  const live = useLiveFilters('/inventory', [warehouse]);
  return (
    <form
      {...live.formProps}
      role="search"
      className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto]"
    >
      <FormField label={t('search')} labelClassName="sr-only">
        {(a11y) => (
          <Input
            {...a11y}
            name="q"
            type="search"
            defaultValue={values.q ?? ''}
            placeholder={t('search')}
            onChange={live.onTyping}
          />
        )}
      </FormField>
      {warehouses.length > 1 ? (
        <FormField label={t('filters.warehouse')} labelClassName="sr-only">
          {(a11y) => (
            <ChoiceSelect
              a11y={a11y}
              value={warehouse}
              onChange={setWarehouse}
              options={[{ value: ALL, label: t('filters.allWarehouses') }, ...warehouses]}
            />
          )}
        </FormField>
      ) : (
        <span className="hidden sm:block" />
      )}
      {warehouse !== ALL && <input type="hidden" name="warehouseId" value={warehouse} />}
      <div className="flex gap-2">
        {filtered && (
          <Link
            href="/inventory"
            className="self-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {t('filters.clear')}
          </Link>
        )}
      </div>
    </form>
  );
}
