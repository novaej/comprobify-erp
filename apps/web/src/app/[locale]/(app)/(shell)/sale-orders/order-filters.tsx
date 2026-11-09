'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { FormField } from '@/components/form-field';
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
  const t = useTranslations('saleOrders');
  const [status, setStatus] = useState(values.status ?? ALL);
  const filtered = Object.values(values).some(Boolean);

  return (
    <form role="search" className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem_auto]">
      <FormField label={t('searchButton')} labelClassName="sr-only">
        {(a11y) => (
          <Input
            {...a11y}
            name="q"
            type="search"
            defaultValue={values.q ?? ''}
            placeholder={t('search')}
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
        <Button type="submit" variant="outline">
          <Search className="mr-1.5 h-4 w-4" aria-hidden />
          {t('filters.apply')}
        </Button>
        {filtered && (
          <Link
            href="/sale-orders"
            className="self-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {t('filters.clear')}
          </Link>
        )}
      </div>
    </form>
  );
}
