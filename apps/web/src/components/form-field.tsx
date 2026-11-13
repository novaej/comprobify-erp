'use client';

import { Label } from '@comprobify/ui/components/label';
import { cn } from '@comprobify/ui/lib/utils';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent, type ReactNode } from 'react';

export type FieldA11yProps = {
  id: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
  // The browser's own message is replaced by ours, shown under the field.
  onInvalid?: (event: FormEvent<HTMLElement>) => void;
};

type Checkable = HTMLElement & { validity: ValidityState; form: HTMLFormElement | null };

// Label, control, hint and error as one unit, tied together for screen readers.
export function FormField({
  label,
  required,
  hint,
  error,
  aside,
  className,
  labelClassName,
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
  // Such as `sr-only` at a width where a shared header names the column.
  labelClassName?: string;
  children: (props: FieldA11yProps) => ReactNode;
}) {
  const uid = useId();
  const t = useTranslations('common');
  // What the browser found wrong on submit (a required field left empty), said in the app's
  // language, in red under the field, like the errors a form is given.
  const [native, setNative] = useState<string>();
  const shown = error ?? native;
  const id = `${uid}-field`;
  const hintId = `${uid}-hint`;
  const errorId = `${uid}-error`;
  const describedBy = [shown ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    // `input` bubbles: typing in the control clears what the browser said about it.
    <div className={cn('min-w-0 space-y-1.5', className)} onInput={() => setNative(undefined)}>
      <div className={cn('flex items-center justify-between', labelClassName)}>
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
        'aria-invalid': shown ? true : undefined,
        onInvalid: (event) => {
          // Ours instead of the browser's tooltip, which is in the browser's language.
          event.preventDefault();
          const control = event.currentTarget as Checkable;
          const { validity } = control;
          setNative(
            validity.valueMissing
              ? t('fieldRequired')
              : validity.rangeUnderflow || validity.rangeOverflow
                ? t('fieldOutOfRange')
                : t('fieldInvalid'),
          );
          // Without the browser's own pass, the first invalid control must be taken to by hand.
          const form = control.form;
          if (form && !form.dataset.invalidFocused) {
            form.dataset.invalidFocused = '1';
            control.focus();
            control.scrollIntoView({ block: 'center' });
            setTimeout(() => delete form.dataset.invalidFocused, 0);
          }
        },
        'aria-describedby': describedBy || undefined,
        'aria-required': required || undefined,
      })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {shown && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {shown}
        </p>
      )}
    </div>
  );
}
