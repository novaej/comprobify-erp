'use client';

import { Button } from '@comprobify/ui/components/button';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useServerAction } from '@/components/use-server-action';
import { retryJobAction } from './actions';

// FR-ADM-5: one failed job back in its queue. Jobs are idempotent, so running it again is safe.
export function RetryJobButton({ queue, id }: { queue: string; id: string }) {
  const t = useTranslations('adminJobs');
  const [open, setOpen] = useState(false);
  const retry = useServerAction(retryJobAction, {
    errors: 'adminError',
    success: t('retried'),
    onDone: () => setOpen(false),
  });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t('retry')}
        <span className="sr-only"> {t('retryFor', { queue })}</span>
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('retryTitle')}
        description={t('retryDescription', { queue })}
        confirmLabel={t('retry')}
        pending={retry.pending}
        error={retry.error}
        onConfirm={() => retry.run({ queue, id })}
      />
    </>
  );
}
