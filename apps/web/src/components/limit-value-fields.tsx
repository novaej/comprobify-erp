'use client';

import { Input } from '@comprobify/ui/components/input';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormField } from './form-field';

// A limit's value, or unlimited. Submits `value` and `unlimited` for the action to read.
export function LimitValueFields({ label, value }: { label: string; value?: number | null }) {
  const t = useTranslations('common');
  const [unlimited, setUnlimited] = useState(value === null);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <FormField label={label} className="flex-1">
        {(props) => (
          <Input
            {...props}
            name="value"
            type="number"
            min={0}
            step={1}
            defaultValue={value ?? ''}
            disabled={unlimited}
            required={!unlimited}
          />
        )}
      </FormField>
      <label className="flex h-8 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="unlimited"
          checked={unlimited}
          onChange={(event) => setUnlimited(event.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        {t('unlimited')}
      </label>
    </div>
  );
}
