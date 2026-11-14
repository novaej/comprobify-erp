'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';

const DEBOUNCE_MS = 300;

// For a filter form that lives in the URL: the list follows what is typed or chosen, with no
// button to press. A soft navigation, so a search box keeps its cursor while the list changes
// under it. `choices` are the hidden-field values (a chosen option), sent once they are in place.
export function useLiveFilters(path: string, choices: readonly unknown[]) {
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mounted = useRef(false);
  const router = useRouter();

  const apply = () => {
    if (!form.current) return;
    const params = new URLSearchParams();
    for (const [name, value] of new FormData(form.current)) {
      if (typeof value === 'string' && value.trim() !== '') params.set(name, value.trim());
    }
    const search = params.toString();
    router.replace(`${path}${search ? `?${search}` : ''}`, { scroll: false });
  };

  useEffect(() => {
    if (mounted.current) apply();
    mounted.current = true;
    // `apply` reads the form as it is when this runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, choices);
  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    formProps: {
      ref: form,
      onSubmit: (event: { preventDefault: () => void }) => {
        event.preventDefault();
        apply();
      },
    },
    // After a pause in typing.
    onTyping: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(apply, DEBOUNCE_MS);
    },
    apply,
  };
}
