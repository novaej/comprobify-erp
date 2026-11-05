import type { DocumentDetail } from '@comprobify/core';
import { cn } from '@comprobify/ui/lib/utils';
import { AlertTriangle, Ban, Check, X } from 'lucide-react';

// What each step of the history means at a glance: done, stopped by SRI, failed to send.
export function EventMark({ event }: { event: DocumentDetail['events'][number] }) {
  const stopped = event.toStatus === 'RETURNED' || event.toStatus === 'NOT_AUTHORIZED';
  const failed = event.toStatus === 'SEND_FAILED';
  const voided = event.type === 'VOIDED';
  const Icon = stopped ? X : failed ? AlertTriangle : voided ? Ban : Check;
  return (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
        stopped && 'bg-destructive text-white',
        failed && 'bg-warning-soft text-warning',
        voided && 'bg-muted text-foreground',
        !stopped && !failed && !voided && 'bg-success-soft text-success',
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={3} />
    </span>
  );
}
