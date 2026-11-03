'use client';

import { Button } from '@comprobify/ui/components/button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@comprobify/ui/components/dialog';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { ActionState } from '@/server/actions';
import { ScrollDialogContent } from './scroll-dialog-content';
import { useServerAction } from './use-server-action';

// A small form in a dialog around one server action: fields in, error beside them,
// a toast on success, closed when done. Hidden values and controlled ones go in `extra`.
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  action,
  errors,
  success,
  extra = {},
  destructive = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  errors: string;
  success?: string;
  extra?: Record<string, string>;
  destructive?: boolean;
  children?: ReactNode;
}) {
  const t = useTranslations('common');
  const run = useServerAction(action, { errors, success, onDone: () => onOpenChange(false) });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) run.clearError();
      }}
    >
      <ScrollDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            for (const [name, value] of Object.entries(extra)) form.set(name, value);
            run.run(form);
          }}
        >
          {children}
          {run.error && (
            <p role="alert" className="text-sm text-destructive">
              {run.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              variant={destructive ? 'destructive' : 'default'}
              disabled={run.pending}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </ScrollDialogContent>
    </Dialog>
  );
}
