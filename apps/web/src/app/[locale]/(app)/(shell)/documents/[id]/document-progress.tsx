import type { DocumentStatus } from '@comprobify/core';
import { cn } from '@comprobify/ui/lib/utils';
import { Check, Loader2, X } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

const STEPS = ['signed', 'sent', 'received', 'authorized'] as const;

// Where each status sits on the way to authorization, and whether it stopped there.
const POSITION: Record<DocumentStatus, { step: number; state: 'current' | 'stopped' | 'done' }> = {
  SIGNED: { step: 0, state: 'current' },
  PENDING_SEND: { step: 1, state: 'current' },
  SEND_FAILED: { step: 1, state: 'stopped' },
  RETURNED: { step: 1, state: 'stopped' },
  RECEIVED: { step: 2, state: 'current' },
  NOT_AUTHORIZED: { step: 3, state: 'stopped' },
  AUTHORIZED: { step: 3, state: 'done' },
  VOIDED: { step: 3, state: 'done' },
};

// FR-DOC-12: the four steps to authorization, so a waiting document shows where it is.
export async function DocumentProgress({ status }: { status: DocumentStatus }) {
  const t = await getTranslations('documents.detail.progress');
  const { step, state } = POSITION[status];
  return (
    <ol aria-label={t('label')} className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
      {STEPS.map((name, index) => {
        const done = index < step || (index === step && state === 'done');
        const current = index === step && state === 'current';
        const stopped = index === step && state === 'stopped';
        return (
          <li
            key={name}
            aria-current={current || stopped ? 'step' : undefined}
            className="flex items-center gap-2"
          >
            {index > 0 && (
              <span
                aria-hidden
                className={cn(
                  'h-px w-6 sm:w-10',
                  done || current || stopped ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
            <span
              aria-hidden
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs',
                done && 'border-primary bg-primary text-primary-foreground',
                current && 'border-primary bg-primary/10 text-primary',
                stopped && 'border-destructive bg-destructive text-white',
                !done && !current && !stopped && 'border-border bg-card',
              )}
            >
              {done ? (
                <Check className="h-3.5 w-3.5" />
              ) : current ? (
                <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
              ) : stopped ? (
                <X className="h-3.5 w-3.5" />
              ) : null}
            </span>
            <span
              className={cn(
                current || stopped ? 'font-medium' : done ? '' : 'text-muted-foreground',
              )}
            >
              {t(`steps.${name}`)}
              <span className="sr-only">
                {' '}
                {done ? t('done') : current ? t('current') : stopped ? t('stopped') : ''}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
