'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { useLocale, useTranslations } from 'next-intl';
import { ActionForm } from '@/components/action-form';
import { FormField } from '@/components/form-field';
import { useFormAction } from '@/components/use-form-action';
import {
  confirmTwoFactorAction,
  disableTwoFactorAction,
  startTwoFactorAction,
  type SetupState,
} from './actions';

// FR-USR-3: set up in two steps, so it is only on once the app produces a valid code.
export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const t = useTranslations('security');
  const tError = useTranslations('securityError');
  const locale = useLocale();
  const start = useFormAction<SetupState>(startTwoFactorAction);
  const confirm = useFormAction<SetupState>(confirmTwoFactorAction);
  const setup = confirm.state.setup ?? start.state.setup;
  const error = (code?: string) => code && (tError.has(code) ? tError(code) : tError('UNKNOWN'));

  if (enabled || confirm.state.done) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-success">{t('enabled')}</p>
        <ActionForm
          action={disableTwoFactorAction}
          errors="securityError"
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          {(pending) => (
            <>
              <FormField label={t('passwordToDisable')} className="flex-1">
                {(props) => (
                  <Input
                    {...props}
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                )}
              </FormField>
              <Button type="submit" variant="outline" disabled={pending}>
                {t('disable')}
              </Button>
            </>
          )}
        </ActionForm>
      </div>
    );
  }

  if (!setup) {
    return (
      <form onSubmit={start.onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="locale" value={locale} />
        <FormField label={t('passwordToEnable')} className="flex-1">
          {(props) => (
            <Input
              {...props}
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          )}
        </FormField>
        <Button type="submit" disabled={start.pending}>
          {t('enable')}
        </Button>
        {start.state.error && (
          <p role="alert" className="text-xs text-destructive">
            {error(start.state.error)}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">{t('scan')}</p>
      {/* A data URL image, not injected markup; next/image has nothing to optimize here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={setup.qrDataUrl}
        alt={t('qrAlt')}
        width={192}
        height={192}
        className="rounded-md border border-border bg-white"
      />
      <p className="text-xs text-muted-foreground">
        {t('manualKey')} <code className="font-mono break-all text-foreground">{setup.secret}</code>
      </p>
      <div>
        <p className="text-sm font-medium">{t('backupTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('backupHint')}</p>
        <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm" aria-label={t('backupTitle')}>
          {setup.backupCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </div>
      <form onSubmit={confirm.onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="locale" value={locale} />
        <FormField label={t('confirmCode')} className="flex-1">
          {(props) => (
            <Input
              {...props}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
            />
          )}
        </FormField>
        <Button type="submit" disabled={confirm.pending}>
          {t('confirm')}
        </Button>
      </form>
      {confirm.state.error && (
        <p role="alert" className="text-xs text-destructive">
          {error(confirm.state.error)}
        </p>
      )}
    </div>
  );
}
