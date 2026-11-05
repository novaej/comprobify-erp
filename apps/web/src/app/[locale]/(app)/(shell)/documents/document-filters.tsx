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

// A GET form: the filters live in the URL, so a filtered list can be shared or reloaded.
export function DocumentFilters({
  statuses,
  issuePoints,
  values,
}: {
  statuses: Choice[];
  issuePoints: Choice[];
  values: { status?: string; issuePointId?: string; from?: string; to?: string; q?: string };
}) {
  const t = useTranslations('documents');
  const [status, setStatus] = useState(values.status ?? ALL);
  const [issuePoint, setIssuePoint] = useState(values.issuePointId ?? ALL);
  const filtered = Object.values(values).some(Boolean);

  return (
    <form
      role="search"
      className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[minmax(0,1fr)_11rem_12rem_10rem_10rem_auto]"
    >
      <FormField
        label={t('searchButton')}
        labelClassName="sr-only"
        className="sm:col-span-2 2xl:col-span-1"
      >
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
      <FormField label={t('filters.issuePoint')} labelClassName="sr-only">
        {(a11y) => (
          <ChoiceSelect
            a11y={a11y}
            value={issuePoint}
            onChange={setIssuePoint}
            options={[{ value: ALL, label: t('filters.allIssuePoints') }, ...issuePoints]}
          />
        )}
      </FormField>
      {issuePoint !== ALL && <input type="hidden" name="issuePointId" value={issuePoint} />}
      {(['from', 'to'] as const).map((name) => (
        <FormField key={name} label={t(`filters.${name}`)} labelClassName="sr-only">
          {(a11y) => (
            <Input
              {...a11y}
              type="date"
              name={name}
              defaultValue={values[name] ?? ''}
              title={t(`filters.${name}`)}
            />
          )}
        </FormField>
      ))}
      <div className="flex gap-2">
        <Button type="submit" variant="outline">
          <Search className="mr-1.5 h-4 w-4" aria-hidden />
          {t('filters.apply')}
        </Button>
        {filtered && (
          <Link
            href="/documents"
            className="self-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {t('filters.clear')}
          </Link>
        )}
      </div>
    </form>
  );
}
