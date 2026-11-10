'use client';

import { Button } from '@comprobify/ui/components/button';
import { RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useServerAction } from '@/components/use-server-action';
import { retryBatchAction } from '../actions';

// FR-BULK-3: the failed items go back to the queue, asked first. A rejected invoice is not one
// of them: it is corrected from its own page.
export function RetryButton({ id, count }: { id: string; count: number }) {
  const t = useTranslations('bulkInvoicing.retry');
  const [open, setOpen] = useState(false);
  const retry = useServerAction(retryBatchAction, {
    errors: 'bulkInvoicingError',
    success: t('done'),
    onDone: () => setOpen(false),
  });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <RotateCw className="mr-1.5 h-4 w-4" aria-hidden />
        {t('button', { count })}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) retry.clearError();
        }}
        title={t('title')}
        description={t('description')}
        detail={t('detail', { count })}
        confirmLabel={t('confirm')}
        pending={retry.pending}
        error={retry.error}
        onConfirm={() => retry.run({ id })}
      />
    </>
  );
}
