'use client';

import { startTransition, useActionState, type FormEvent } from 'react';
import type { ActionState } from '@/server/actions';

// React 19 resets a form after its `action` runs, so an error would wipe what the
// user typed. Submitting through onSubmit keeps the fields, files included.
export function useFormAction<State extends ActionState = ActionState>(
  action: (state: Awaited<State>, form: FormData) => State | Promise<State>,
  initial = {} as Awaited<State>,
) {
  const [state, dispatch, pending] = useActionState<State, FormData>(action, initial);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => dispatch(form));
  };
  return { state, onSubmit, pending };
}
