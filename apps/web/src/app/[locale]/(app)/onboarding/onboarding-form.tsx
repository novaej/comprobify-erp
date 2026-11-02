'use client';

import { Button } from '@comprobify/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@comprobify/ui/components/card';
import { Input } from '@comprobify/ui/components/input';
import { useLocale, useTranslations } from 'next-intl';

import { FormField } from '@/components/form-field';
import { useFormAction } from '@/components/use-form-action';
import { onboardAction } from './actions';

export function OnboardingForm() {
  const t = useTranslations('onboarding');
  const tError = useTranslations('onboardingError');
  const locale = useLocale();
  const { state, onSubmit, pending } = useFormAction(onboardAction);
  const message =
    state.error && (tError.has(state.error) ? tError(state.error) : tError('UNKNOWN'));

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" name="locale" value={locale} />
      <fieldset disabled={pending} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('companySection')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label={t('ruc')} hint={t('rucHint')}>
              {(props) => (
                <Input
                  {...props}
                  name="ruc"
                  inputMode="numeric"
                  pattern="[0-9]{13}"
                  maxLength={13}
                  required
                />
              )}
            </FormField>
            <FormField label={t('legalName')}>
              {(props) => <Input {...props} name="legalName" required />}
            </FormField>
            <FormField label={t('tradeName')} hint={t('tradeNameHint')}>
              {(props) => <Input {...props} name="tradeName" />}
            </FormField>
            <FormField label={t('mainAddress')}>
              {(props) => <Input {...props} name="mainAddress" required />}
            </FormField>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="requiredAccounting"
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                {t('requiredAccounting')}
                <span className="block text-xs text-muted-foreground">
                  {t('requiredAccountingHint')}
                </span>
              </span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('certificateSection')}</CardTitle>
            <CardDescription>{t('certificateHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label={t('certificateFile')}>
              {(props) => (
                <Input {...props} name="certificate" type="file" accept=".p12,.pfx" required />
              )}
            </FormField>
            <FormField label={t('certificatePassword')}>
              {(props) => (
                <Input {...props} name="certificatePassword" type="password" autoComplete="off" />
              )}
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('logoSection')}</CardTitle>
            <CardDescription>{t('logoHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FormField label={t('logoFile')}>
              {(props) => (
                <Input {...props} name="logo" type="file" accept="image/png,image/jpeg,image/gif" />
              )}
            </FormField>
          </CardContent>
        </Card>

        <details className="rounded-xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">{t('advanced')}</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField label={t('branchCode')}>
              {(props) => (
                <Input
                  {...props}
                  name="branchCode"
                  defaultValue="001"
                  pattern="[0-9]{3}"
                  maxLength={3}
                />
              )}
            </FormField>
            <FormField label={t('issuePointCode')}>
              {(props) => (
                <Input
                  {...props}
                  name="issuePointCode"
                  defaultValue="001"
                  pattern="[0-9]{3}"
                  maxLength={3}
                />
              )}
            </FormField>
            <FormField label={t('branchName')}>
              {(props) => (
                <Input {...props} name="branchName" defaultValue={t('branchNameDefault')} />
              )}
            </FormField>
            <FormField label={t('branchAddress')} hint={t('branchAddressHint')}>
              {(props) => <Input {...props} name="branchAddress" />}
            </FormField>
          </div>
        </details>
      </fieldset>

      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <Button type="submit" className="h-11 w-full text-base" disabled={pending}>
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
