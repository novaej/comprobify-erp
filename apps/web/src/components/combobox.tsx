'use client';

import { Input } from '@comprobify/ui/components/input';
import { cn } from '@comprobify/ui/lib/utils';
import { useId, useState, type KeyboardEvent, type Ref } from 'react';
import type { FieldA11yProps } from './form-field';

export type ComboOption = { value: string; label: string; detail?: string };

// A text field with suggestions (ARIA 1.2 combobox): type to filter, arrows to move,
// Enter to pick, Escape to close. Free text stays allowed; picking fills the rest.
export function Combobox({
  value,
  onInputChange,
  options,
  onPick,
  a11y,
  label,
  placeholder,
  emptyText,
  listLabel,
  inputRef,
  onKeyDown,
  className,
}: {
  value: string;
  onInputChange: (value: string) => void;
  // Already filtered for `value`.
  options: ComboOption[];
  onPick: (option: ComboOption) => void;
  a11y?: FieldA11yProps;
  // When no visible label sits beside it.
  label?: string;
  placeholder?: string;
  emptyText: string;
  listLabel: string;
  inputRef?: Ref<HTMLInputElement>;
  // Keys the list doesn't use, such as Enter with the list closed.
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const showing = open && value.trim() !== '';

  const pick = (option: ComboOption) => {
    onPick(option);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!showing) {
        setOpen(true);
        setActive(0);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + options.length) % Math.max(options.length, 1));
      return;
    }
    if (event.key === 'Enter' && showing && options[active]) {
      event.preventDefault();
      pick(options[active]);
      return;
    }
    if (event.key === 'Escape' && showing) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    onKeyDown?.(event);
  };

  return (
    <div className={cn('relative', className)}>
      <Input
        {...a11y}
        ref={inputRef}
        role="combobox"
        aria-label={a11y ? undefined : label}
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={listId}
        aria-activedescendant={showing && options[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onInputChange(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={listLabel}
        hidden={!showing}
        className="absolute top-full left-0 z-20 mt-1 max-h-64 w-full min-w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
      >
        {options.length === 0 ? (
          <li
            role="option"
            aria-disabled
            aria-selected={false}
            className="px-2 py-1.5 text-muted-foreground"
          >
            {emptyText}
          </li>
        ) : (
          options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // Keeps focus in the field, so the blur doesn't close the list first.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(option)}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'cursor-pointer rounded-md px-2 py-1.5',
                index === active && 'bg-accent text-accent-foreground',
              )}
            >
              <span className="block truncate">{option.label}</span>
              {option.detail && (
                <span className="block truncate text-xs text-muted-foreground">
                  {option.detail}
                </span>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
