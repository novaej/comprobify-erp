'use client';

import { Button } from '@comprobify/ui/components/button';
import { Textarea } from '@comprobify/ui/components/textarea';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChoiceSelect } from '@/components/choice-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import { ToneBadge } from '@/components/tone-badge';
import { useServerAction } from '@/components/use-server-action';
import { reactivateAction, suspendAction } from './actions';

// FR-BILL-9: suspend a company with a reason, or lift it. Its twin follows (ADR-031).
export function SuspensionCard({
  realTenantId,
  suspended,
  reasons,
}: {
  realTenantId: string;
  // Null while active.
  suspended: { reason: string; since: string } | null;
  reasons: readonly string[];
}) {
  const t = useTranslations('admin.suspension');
  const [dialog, setDialog] = useState<'suspend' | 'reactivate' | null>(null);
  const [reason, setReason] = useState<string>(reasons[0] ?? 'OTHER');
  const reactivate = useServerAction(reactivateAction, {
    errors: 'adminError',
    success: t('reactivated'),
    onDone: () => setDialog(null),
  });
  const close = (open: boolean) => !open && setDialog(null);

  return (
    <SectionCard
      className="mb-4"
      title={t('title')}
      description={
        suspended
          ? t('suspendedSince', { reason: t(`reasons.${suspended.reason}`), date: suspended.since })
          : t('activeDescription')
      }
      action={
        suspended ? (
          <>
            <ToneBadge tone="danger">{t('suspended')}</ToneBadge>
            <Button size="sm" variant="outline" onClick={() => setDialog('reactivate')}>
              {t('reactivate')}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setDialog('suspend')}>
            {t('suspend')}
          </Button>
        )
      }
    >
      <FormDialog
        open={dialog === 'suspend'}
        onOpenChange={close}
        title={t('suspendTitle')}
        description={t('suspendDescription')}
        submitLabel={t('suspend')}
        action={suspendAction}
        errors="adminError"
        success={t('suspendedDone')}
        destructive
        extra={{ realTenantId, reason }}
      >
        <FormField label={t('reason')}>
          {(a11y) => (
            <ChoiceSelect
              a11y={a11y}
              value={reason}
              onChange={setReason}
              options={reasons.map((value) => ({ value, label: t(`reasons.${value}`) }))}
            />
          )}
        </FormField>
        <FormField label={t('note')} hint={t('noteHint')}>
          {(a11y) => <Textarea {...a11y} name="note" maxLength={300} />}
        </FormField>
      </FormDialog>
      <ConfirmDialog
        open={dialog === 'reactivate'}
        onOpenChange={close}
        title={t('reactivateTitle')}
        description={t('reactivateDescription')}
        confirmLabel={t('reactivate')}
        pending={reactivate.pending}
        error={reactivate.error}
        onConfirm={() => reactivate.run({ realTenantId })}
      />
    </SectionCard>
  );
}
