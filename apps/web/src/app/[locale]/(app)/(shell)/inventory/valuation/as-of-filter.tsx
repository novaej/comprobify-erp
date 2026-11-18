'use client';

import { Input } from '@comprobify/ui/components/input';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/form-field';
import { useLiveFilters } from '@/components/use-live-filters';

// The day the valuation is for, in the URL; the page follows as a date is chosen.
export function AsOfFilter({ asOf, today }: { asOf: string; today: string }) {
  const t = useTranslations('inventory.valuation');
  const live = useLiveFilters('/inventory/valuation', []);
  return (
    <form {...live.formProps} role="search" className="max-w-xs">
      <FormField label={t('asOf')} hint={t('asOfHint')}>
        {(a11y) => (
          <Input
            {...a11y}
            name="asOf"
            type="date"
            max={today}
            defaultValue={asOf}
            onChange={live.apply}
          />
        )}
      </FormField>
    </form>
  );
}
