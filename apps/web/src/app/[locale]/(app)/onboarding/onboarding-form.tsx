'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { FormActionBar } from '@/components/form-action-bar';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import { useFormAction } from '@/components/use-form-action';
import { onboardAction } from './actions';

export function OnboardingForm({ regimes }: { regimes: Choice[] }) {
  const t = useTranslations('onboarding');
  const tError = useTranslations('onboardingError');
  const locale = useLocale();
  const { state, onSubmit, pending } = useFormAction(onboardAction);
  const [regime, setRegime] = useState('GENERAL');
  const message =
    state.error && (tError.has(state.error) ? tError(state.error) : tError('UNKNOWN'));

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="taxRegime" value={regime} />
      <fieldset disabled={pending} className="space-y-6">
        <SectionCard title={t('companySection')}>
          <div className="space-y-4">
            <FormField required label={t('ruc')} hint={t('rucHint')}>
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
            <FormField required label={t('legalName')}>
              {(props) => <Input {...props} name="legalName" required />}
            </FormField>
            <FormField label={t('tradeName')} hint={t('tradeNameHint')}>
              {(props) => <Input {...props} name="tradeName" />}
            </FormField>
            <FormField required label={t('mainAddress')}>
              {(props) => <Input {...props} name="mainAddress" required />}
            </FormField>
            <FormField required label={t('taxRegime')} hint={t('taxRegimeHint')}>
              {(props) => (
                <ChoiceSelect value={regime} onChange={setRegime} options={regimes} a11y={props} />
              )}
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
          </div>
        </SectionCard>

        <SectionCard title={t('certificateSection')} description={t('certificateHint')}>
          <div className="space-y-4">
            <FormField required label={t('certificateFile')}>
              {(props) => (
                <Input {...props} name="certificate" type="file" accept=".p12,.pfx" required />
              )}
            </FormField>
            <FormField label={t('certificatePassword')}>
              {(props) => (
                <Input {...props} name="certificatePassword" type="password" autoComplete="off" />
              )}
            </FormField>
          </div>
        </SectionCard>

        <SectionCard title={t('logoSection')} description={t('logoHint')}>
          <div>
            <FormField label={t('logoFile')}>
              {(props) => (
                <Input {...props} name="logo" type="file" accept="image/png,image/jpeg,image/gif" />
              )}
            </FormField>
          </div>
        </SectionCard>

        <details className="rounded-xl border border-border bg-card p-6 shadow-sm">
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
            <FormField label={t('firstInvoiceNumber')} hint={t('firstInvoiceNumberHint')}>
              {(props) => (
                <Input
                  {...props}
                  name="firstInvoiceNumber"
                  type="number"
                  min={1}
                  max={999999999}
                  step={1}
                  defaultValue={1}
                  className="tabular-nums"
                />
              )}
            </FormField>
          </div>
        </details>
      </fieldset>

      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <FormActionBar>
        <Button type="submit" disabled={pending}>
          {pending ? t('submitting') : t('submit')}
        </Button>
      </FormActionBar>
    </form>
  );
}
