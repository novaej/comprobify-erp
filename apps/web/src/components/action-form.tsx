'use client';

import { cn } from '@comprobify/ui/lib/utils';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { ActionState } from '@/server/actions';
import { useFormAction } from './use-form-action';

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

// A small form around one server action: locale, hidden fields, and the error code
// shown from the given message namespace.
export function ActionForm({
  action,
  hidden = {},
  errors,
  className,
  children,
}: {
  action: Action;
  hidden?: Record<string, string>;
  errors: string;
  className?: string;
  children: (pending: boolean) => ReactNode;
}) {
  const locale = useLocale();
  const t = useTranslations(errors);
  const { state, onSubmit, pending } = useFormAction(action);
  const message = state.error && (t.has(state.error) ? t(state.error) : t('UNKNOWN'));

  return (
    <form onSubmit={onSubmit} className={cn('space-y-2', className)}>
      <input type="hidden" name="locale" value={locale} />
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children(pending)}
      {message && (
        <p role="alert" className="text-xs text-destructive">
          {message}
        </p>
      )}
    </form>
  );
}
