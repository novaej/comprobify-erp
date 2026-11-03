'use client';

import { Label } from '@comprobify/ui/components/label';
import { cn } from '@comprobify/ui/lib/utils';
import { useId, type ReactNode } from 'react';

export type FieldA11yProps = {
  id: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
};

// Label, control, hint and error as one unit, tied together for screen readers.
export function FormField({
  label,
  required,
  hint,
  error,
  aside,
  className,
  children,
}: {
  label: ReactNode;
  // Marked with an asterisk; the control still needs its own `required`.
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  // Shown next to the label, such as a "forgot password" link.
  aside?: ReactNode;
  className?: string;
  children: (props: FieldA11yProps) => ReactNode;
}) {
  const uid = useId();
  const id = `${uid}-field`;
  const hintId = `${uid}-hint`;
  const errorId = `${uid}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>
          {label}
          {required && (
            <span className="text-destructive" aria-hidden>
              {' '}
              *
            </span>
          )}
        </Label>
        {aside}
      </div>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
        'aria-required': required || undefined,
      })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
