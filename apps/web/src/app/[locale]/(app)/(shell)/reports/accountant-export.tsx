'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Download } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';

// FR-REP-3: a month, and the file. A plain GET to the download route, so the browser saves it.
export function AccountantExport({ month }: { month: string }) {
  const t = useTranslations('reports.accountant');
  const locale = useLocale();
  return (
    <SectionCard title={t('title')} description={t('description')} className="mt-6">
      <form
        method="get"
        action={`/${locale}/reports/accountant/zip`}
        className="flex flex-wrap items-end gap-3"
      >
        <FormField label={t('month')}>
          {(a11y) => <Input {...a11y} type="month" name="month" defaultValue={month} required />}
        </FormField>
        <Button type="submit" variant="outline">
          <Download className="mr-1.5 h-4 w-4" aria-hidden />
          {t('download')}
        </Button>
      </form>
    </SectionCard>
  );
}
