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
import { ScrollDialogContent } from './scroll-dialog-content';

// The in-app window.confirm(): asked before anything destructive or immediate.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  detail,
  confirmLabel,
  destructive = false,
  pending = false,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  // What is being acted on, such as a name, shown under the description.
  detail?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  error?: string;
  onConfirm: () => void;
}) {
  const t = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ScrollDialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {detail && <p className="text-sm font-medium break-words">{detail}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={pending}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </ScrollDialogContent>
    </Dialog>
  );
}
