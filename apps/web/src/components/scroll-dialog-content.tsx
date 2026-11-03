'use client';

import { DialogContent } from '@comprobify/ui/components/dialog';
import { cn } from '@comprobify/ui/lib/utils';
import type { ComponentProps } from 'react';

// Capped to the viewport, so the footer buttons stay reachable on a short phone.
export function ScrollDialogContent({ className, ...props }: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn('max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-5 sm:p-6', className)}
      {...props}
    />
  );
}
