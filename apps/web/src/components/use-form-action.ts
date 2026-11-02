'use client';

import { startTransition, useActionState, type FormEvent } from 'react';
import type { ActionState } from '@/server/actions';

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

// React 19 resets a form after its `action` runs, so an error would wipe what the
// user typed. Submitting through onSubmit keeps the fields, files included.
export function useFormAction(action: Action) {
  const [state, dispatch, pending] = useActionState(action, {});
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => dispatch(form));
  };
  return { state, onSubmit, pending };
}
