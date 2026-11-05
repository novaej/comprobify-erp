'use client';

import { Button, buttonVariants } from '@comprobify/ui/components/button';
import { toast } from '@comprobify/ui/components/sonner';
import { Ban, Mail, PencilLine, RotateCcw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useServerAction } from '@/components/use-server-action';
import { Link } from '@/i18n/navigation';
import { reissueAction, resendAction, voidAction } from './actions';

type Allowed = { correct: boolean; reissue: boolean; void: boolean; resend: boolean };

// FR-DOC-6 to FR-DOC-8, FR-DOC-11: what a document allows now, each asked first.
export function DocumentActions({
  id,
  allowed,
  today,
  todayShown,
  voidDeadline,
  buyerEmail,
}: {
  id: string;
  allowed: Allowed;
  // YYYY-MM-DD, as the re-issue confirms it.
  today: string;
  todayShown: string;
  voidDeadline: string;
  buyerEmail: string | null;
}) {
  const t = useTranslations('documents.actions');
  const tError = useTranslations('documentsError');
  const locale = useLocale();
  const [open, setOpen] = useState<'reissue' | 'void' | 'attest' | 'resend' | null>(null);
  const close = () => setOpen(null);
  const reissue = useServerAction(reissueAction, {
    errors: 'documentsError',
    success: t('reissued'),
    onDone: close,
  });
  const resend = useServerAction(resendAction, {
    errors: 'documentsError',
    success: t('resent'),
    onDone: close,
  });
  // Voiding needs the error's code: SRI_UNAVAILABLE offers the user's attestation instead.
  const [voidError, setVoidError] = useState<string>();
  const [voiding, startVoid] = useTransition();
  const runVoid = (attested: boolean) => {
    const form = new FormData();
    form.set('locale', locale);
    form.set('id', id);
    form.set('attested', String(attested));
    startVoid(async () => {
      const state = await voidAction({}, form);
      if (state.error === 'SRI_UNAVAILABLE' && !attested) {
        setVoidError(undefined);
        setOpen('attest');
        return;
      }
      if (state.error) {
        setVoidError(tError.has(state.error) ? tError(state.error) : tError('UNKNOWN'));
        return;
      }
      setVoidError(undefined);
      toast.success(t('voided'));
      close();
    });
  };

  if (!Object.values(allowed).some(Boolean)) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {allowed.correct && (
        <Link href={`/documents/${id}/correct`} className={buttonVariants({ size: 'sm' })}>
          <PencilLine className="mr-1.5 h-4 w-4" aria-hidden />
          {t('correct')}
        </Link>
      )}
      {allowed.reissue && (
        <Button size="sm" onClick={() => setOpen('reissue')}>
          <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />
          {t('reissue')}
        </Button>
      )}
      {allowed.resend && (
        <Button size="sm" variant="outline" onClick={() => setOpen('resend')}>
          <Mail className="mr-1.5 h-4 w-4" aria-hidden />
          {t('resend')}
        </Button>
      )}
      {allowed.void && (
        <Button size="sm" variant="outline" onClick={() => setOpen('void')}>
          <Ban className="mr-1.5 h-4 w-4" aria-hidden />
          {t('void')}
        </Button>
      )}

      <ConfirmDialog
        open={open === 'reissue'}
        onOpenChange={(next) => {
          if (!next) {
            close();
            reissue.clearError();
          }
        }}
        title={t('reissueTitle')}
        description={t('reissueDescription', { date: todayShown })}
        confirmLabel={t('reissueConfirm', { date: todayShown })}
        pending={reissue.pending}
        error={reissue.error}
        onConfirm={() => reissue.run({ id, issueDate: today })}
      />
      <ConfirmDialog
        open={open === 'resend'}
        onOpenChange={(next) => {
          if (!next) {
            close();
            resend.clearError();
          }
        }}
        title={t('resendTitle')}
        description={t('resendDescription')}
        detail={buyerEmail}
        confirmLabel={t('resendConfirm')}
        pending={resend.pending}
        error={resend.error}
        onConfirm={() => resend.run({ id })}
      />
      <ConfirmDialog
        open={open === 'void'}
        onOpenChange={(next) => {
          if (!next) {
            close();
            setVoidError(undefined);
          }
        }}
        title={t('voidTitle')}
        description={t('voidDescription', { deadline: voidDeadline })}
        confirmLabel={t('voidConfirm')}
        destructive
        pending={voiding}
        error={voidError}
        onConfirm={() => runVoid(false)}
      />
      <ConfirmDialog
        open={open === 'attest'}
        onOpenChange={(next) => {
          if (!next) {
            close();
            setVoidError(undefined);
          }
        }}
        title={t('attestTitle')}
        description={t('attestDescription')}
        confirmLabel={t('attestConfirm')}
        destructive
        pending={voiding}
        error={voidError}
        onConfirm={() => runVoid(true)}
      />
    </div>
  );
}
