'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChoiceSelect } from '@/components/choice-select';
import { FormField } from '@/components/form-field';

// A GET form: the range and the grouping live in the URL, so a report can be shared or reloaded.
export function ReportFilters({
  from,
  to,
  groupBy,
  groups,
}: {
  from: string;
  to: string;
  // Only the sales report groups; the others pass none.
  groupBy?: string;
  groups?: { value: string; label: string }[];
}) {
  const t = useTranslations('reports');
  const [group, setGroup] = useState(groupBy ?? groups?.[0]?.value ?? '');

  return (
    <form
      role="search"
      className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_10rem_14rem_auto]"
    >
      {(['from', 'to'] as const).map((name) => (
        <FormField key={name} label={t(`filters.${name}`)}>
          {(a11y) => (
            <Input
              {...a11y}
              type="date"
              name={name}
              defaultValue={name === 'from' ? from : to}
              required
            />
          )}
        </FormField>
      ))}
      {groups && (
        <>
          <FormField label={t('filters.groupBy')}>
            {(a11y) => (
              <ChoiceSelect a11y={a11y} value={group} onChange={setGroup} options={groups} />
            )}
          </FormField>
          <input type="hidden" name="groupBy" value={group} />
        </>
      )}
      <div className="flex items-end">
        <Button type="submit" variant="outline">
          <Search className="mr-1.5 h-4 w-4" aria-hidden />
          {t('filters.apply')}
        </Button>
      </div>
    </form>
  );
}
