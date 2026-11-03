'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@comprobify/ui/components/select';
import type { FieldA11yProps } from './form-field';

export type Choice = { value: string; label: string };

// The styled select every screen uses, never a native <select>.
export function ChoiceSelect({
  value,
  onChange,
  options,
  a11y,
  label,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Choice[];
  // From FormField, or `label` alone when no visible label sits beside it.
  a11y?: FieldA11yProps;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select<string>
      value={value}
      onValueChange={(next) => next && onChange(next)}
      disabled={disabled}
    >
      <SelectTrigger
        {...a11y}
        aria-label={a11y ? undefined : label}
        className={className ?? 'w-full'}
      >
        <SelectValue>
          {(selected: string | null) =>
            options.find((option) => option.value === selected)?.label ?? ''
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="w-auto min-w-(--anchor-width)">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
