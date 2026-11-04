'use client';

import { toast } from '@comprobify/ui/components/sonner';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { ActionState } from '@/server/actions';

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

// Runs a server action from a dialog or a confirmation: the error stays beside the
// control that caused it, and success is a toast, as every screen does it.
export function useServerAction(
  action: Action,
  options: { errors: string; success?: string; onDone?: () => void },
) {
  const locale = useLocale();
  const t = useTranslations(options.errors);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  // `success` here overrides the hook's, when it depends on what this call does.
  const run = (fields: FormData | Record<string, string>, call: { success?: string } = {}) => {
    const form = fields instanceof FormData ? fields : new FormData();
    if (!(fields instanceof FormData))
      for (const [name, value] of Object.entries(fields)) form.set(name, value);
    form.set('locale', locale);
    startTransition(async () => {
      const state = await action({}, form);
      if (state.error) {
        setError(t.has(state.error) ? t(state.error) : t('UNKNOWN'));
        return;
      }
      setError(undefined);
      const message = call.success ?? options.success;
      if (message) toast.success(message);
      options.onDone?.();
    });
  };

  return { run, pending, error, clearError: () => setError(undefined) };
}
