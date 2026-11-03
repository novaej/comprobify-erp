'use client';

import { toast } from '@comprobify/ui/components/sonner';
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
  success,
  className,
  children,
}: {
  action: Action;
  hidden?: Record<string, string>;
  errors: string;
  // A toast once the action succeeds.
  success?: string;
  className?: string;
  children: (pending: boolean) => ReactNode;
}) {
  const locale = useLocale();
  const t = useTranslations(errors);
  // Toasted as the result arrives: the form may be gone from the page by the next render.
  const { state, onSubmit, pending } = useFormAction<ActionState>(async (previous, form) => {
    const next = await action(previous, form);
    if (next.done && success) toast.success(success);
    return next;
  });
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
