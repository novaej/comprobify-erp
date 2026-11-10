'use client';

import { Button } from '@comprobify/ui/components/button';
import { Textarea } from '@comprobify/ui/components/textarea';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { resolveCardAction } from '../payments/actions';

// ADR-033: once the charge is reversed in Payphone's dashboard, the operator says how.
export function ResolveButton({ attemptId, label }: { attemptId: string; label: string }) {
  const t = useTranslations('adminCards');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t('resolve')}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('resolveTitle')}
        description={t('resolveDescription', { charge: label })}
        submitLabel={t('resolve')}
        action={resolveCardAction}
        errors="adminError"
        success={t('resolved')}
        extra={{ attemptId }}
      >
        <FormField label={t('note')} hint={t('noteHint')} required>
          {(a11y) => <Textarea {...a11y} name="note" required minLength={3} maxLength={300} />}
        </FormField>
      </FormDialog>
    </>
  );
}
