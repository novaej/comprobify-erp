'use client';

import { Input } from '@comprobify/ui/components/input';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { FormField } from '@/components/form-field';
import { useLiveFilters } from '@/components/use-live-filters';
import { Link } from '@/i18n/navigation';

const ALL = 'all';

// A GET form, as on the document list: the filters live in the URL.
export function OrderFilters({
  statuses,
  values,
}: {
  statuses: Choice[];
  values: { status?: string; q?: string };
}) {
  const t = useTranslations('purchaseOrders');
  const [status, setStatus] = useState(values.status ?? ALL);
  const filtered = Object.values(values).some(Boolean);
  const live = useLiveFilters('/purchase-orders', [status]);

  return (
    <form
      {...live.formProps}
      role="search"
      className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem_auto]"
    >
      <FormField label={t('searchButton')} labelClassName="sr-only">
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
      <FormField label={t('filters.status')} labelClassName="sr-only">
        {(a11y) => (
          <ChoiceSelect
            a11y={a11y}
            value={status}
            onChange={setStatus}
            options={[{ value: ALL, label: t('filters.allStatuses') }, ...statuses]}
          />
        )}
      </FormField>
      {status !== ALL && <input type="hidden" name="status" value={status} />}
      <div className="flex gap-2">
        {filtered && (
          <Link
            href="/purchase-orders"
            className="self-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {t('filters.clear')}
          </Link>
        )}
      </div>
    </form>
  );
}
