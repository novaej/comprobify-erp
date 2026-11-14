'use client';

import { Input } from '@comprobify/ui/components/input';
import { Search, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { ChoiceSelect, type Choice } from './choice-select';

export type ToolbarFilter = {
  // The URL parameter, such as `status`.
  param: string;
  label: string;
  options: Choice[];
  // The value that means "no filter": it removes the parameter.
  all: string;
  value: string;
};

const DEBOUNCE_MS = 300;

// The search and filters of a list. They live in the URL, so a filtered list can be shared or
// reloaded, and the list follows as you type or choose: no button to press.
export function ListToolbar({
  searchLabel,
  query,
  filters = [],
}: {
  searchLabel: string;
  query: string;
  filters?: ToolbarFilter[];
}) {
  const t = useTranslations('listToolbar');
  const router = useRouter();
  const pathname = usePathname();
  const current = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(query);
  const sent = useRef(query);

  // One change to the URL: other parameters stay, the page goes back to the first.
  const go = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(current.toString());
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    next.delete('page');
    const search = next.toString();
    startTransition(() =>
      router.replace(`${pathname}${search ? `?${search}` : ''}`, { scroll: false }),
    );
  };

  // Waits for a pause in typing before asking the server.
  useEffect(() => {
    const value = text.trim();
    if (value === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = value;
      go({ q: value || null });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `go` is rebuilt each render and only reads the URL as it is when the timer fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div role="search" aria-busy={pending} className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-md min-w-56 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label={searchLabel}
          placeholder={searchLabel}
          className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
        />
        {text && (
          <button
            type="button"
            onClick={() => {
              setText('');
              sent.current = '';
              go({ q: null });
            }}
            aria-label={t('clear')}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {filters.map((filter) => (
        <div key={filter.param} className="w-full min-w-44 sm:w-auto">
          <ChoiceSelect
            label={filter.label}
            value={filter.value}
            options={filter.options}
            onChange={(value) => go({ [filter.param]: value === filter.all ? null : value })}
          />
        </div>
      ))}
    </div>
  );
}
