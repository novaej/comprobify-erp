'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { FormField } from '@/components/form-field';
import {
  addModuleAction,
  changePlanAction,
  clearLimitAction,
  clearOverrideAction,
  removeModuleAction,
  setBillingAction,
  setLimitAction,
  setOverrideAction,
  setPriceAction,
} from './actions';

const selectClass =
  'h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export type Choice = { key: string; label: string };

export function PlanForm({
  realTenantId,
  current,
  plans,
}: {
  realTenantId: string;
  current: string;
  plans: Choice[];
}) {
  const t = useTranslations('admin');
  return (
    <ActionForm
      action={changePlanAction}
      hidden={{ realTenantId }}
      errors="adminError"
      className="flex flex-wrap items-end gap-2"
    >
      {(pending) => (
        <>
          <select
            name="planKey"
            defaultValue={current}
            aria-label={t('plan')}
            className={selectClass}
          >
            {plans.map((plan) => (
              <option key={plan.key} value={plan.key}>
                {plan.label}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" disabled={pending}>
            {t('changePlan')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function BillingForm({
  realTenantId,
  complimentary,
  reason,
}: {
  realTenantId: string;
  complimentary: boolean;
  reason: string | null;
}) {
  const t = useTranslations('admin');
  const [checked, setChecked] = useState(complimentary);
  return (
    <ActionForm action={setBillingAction} hidden={{ realTenantId }} errors="adminError">
      {(pending) => (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="complimentary"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            {t('complimentaryLabel')}
          </label>
          {checked && (
            <FormField label={t('reason')}>
              {(props) => (
                <Input
                  {...props}
                  name="reason"
                  defaultValue={reason ?? ''}
                  required
                  minLength={3}
                />
              )}
            </FormField>
          )}
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {t('save')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function PriceForm({ realTenantId, price }: { realTenantId: string; price: string | null }) {
  const t = useTranslations('admin');
  return (
    <ActionForm
      action={setPriceAction}
      hidden={{ realTenantId }}
      errors="adminError"
      className="flex flex-wrap items-end gap-2"
    >
      {(pending) => (
        <>
          <FormField label={t('monthlyPrice')}>
            {(props) => (
              <Input
                {...props}
                name="monthlyPrice"
                inputMode="decimal"
                pattern="\d{1,10}(\.\d{1,2})?"
                defaultValue={price ?? ''}
                className="w-36"
              />
            )}
          </FormField>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {t('save')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function AddModuleForm({
  realTenantId,
  modules,
}: {
  realTenantId: string;
  modules: Choice[];
}) {
  const t = useTranslations('admin');
  if (modules.length === 0) return null;
  return (
    <ActionForm
      action={addModuleAction}
      hidden={{ realTenantId }}
      errors="adminError"
      className="flex flex-wrap items-end gap-2"
    >
      {(pending) => (
        <>
          <select name="moduleKey" aria-label={t('module')} className={selectClass}>
            {modules.map((module) => (
              <option key={module.key} value={module.key}>
                {module.label}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {t('addModule')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

// A scheduled removal is undone by adding the module again.
export function ModuleRowForm({
  realTenantId,
  moduleKey,
  scheduled,
  name,
}: {
  realTenantId: string;
  moduleKey: string;
  scheduled: boolean;
  name: string;
}) {
  const t = useTranslations('admin');
  return (
    <ActionForm
      action={scheduled ? addModuleAction : removeModuleAction}
      hidden={{ realTenantId, moduleKey }}
      errors="adminError"
    >
      {(pending) => (
        <Button type="submit" size="sm" variant="ghost" disabled={pending}>
          {scheduled ? t('keepModuleFor', { name }) : t('removeModuleFor', { name })}
        </Button>
      )}
    </ActionForm>
  );
}

function ValueFields({ value, label }: { value?: number | null; label: string }) {
  const t = useTranslations('admin');
  const [unlimited, setUnlimited] = useState(value === null);
  return (
    <>
      <Input
        name="value"
        type="number"
        min={0}
        step={1}
        aria-label={label}
        defaultValue={value ?? ''}
        disabled={unlimited}
        className="w-28"
      />
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          name="unlimited"
          checked={unlimited}
          onChange={(event) => setUnlimited(event.target.checked)}
        />
        {t('unlimited')}
      </label>
    </>
  );
}

export function LimitForm({
  realTenantId,
  featureKey,
  label,
  value,
  isSet,
}: {
  realTenantId: string;
  featureKey: string;
  label: string;
  value: number | null | undefined;
  // Personalizado has its own value, so it can go back to the plan's.
  isSet: boolean;
}) {
  const t = useTranslations('admin');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionForm
        action={setLimitAction}
        hidden={{ realTenantId, featureKey }}
        errors="adminError"
        className="flex flex-wrap items-center gap-2"
      >
        {(pending) => (
          <>
            <ValueFields value={value} label={label} />
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {t('save')}
            </Button>
          </>
        )}
      </ActionForm>
      {isSet && (
        <ActionForm
          action={clearLimitAction}
          hidden={{ realTenantId, featureKey }}
          errors="adminError"
        >
          {(pending) => (
            <Button type="submit" size="sm" variant="ghost" disabled={pending}>
              {t('usePlanValue')}
            </Button>
          )}
        </ActionForm>
      )}
    </div>
  );
}

export function OverrideForm({
  realTenantId,
  features,
}: {
  realTenantId: string;
  features: { key: string; kind: 'BOOLEAN' | 'LIMIT' }[];
}) {
  const t = useTranslations('admin');
  const [key, setKey] = useState(features[0]?.key ?? '');
  const isLimit = features.find((feature) => feature.key === key)?.kind === 'LIMIT';
  return (
    <ActionForm
      action={setOverrideAction}
      hidden={{ realTenantId }}
      errors="adminError"
      className="space-y-3"
    >
      {(pending) => (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              name="featureKey"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              aria-label={t('feature')}
              className={selectClass}
            >
              {features.map((feature) => (
                <option key={feature.key} value={feature.key}>
                  {feature.key}
                </option>
              ))}
            </select>
            {isLimit ? (
              <>
                <input type="hidden" name="effect" value="LIMIT" />
                <ValueFields label={t('limitValue')} />
              </>
            ) : (
              <select name="effect" aria-label={t('effect')} className={selectClass}>
                <option value="GRANT">{t('effects.GRANT')}</option>
                <option value="REVOKE">{t('effects.REVOKE')}</option>
              </select>
            )}
          </div>
          <FormField label={t('reason')}>
            {(props) => <Input {...props} name="reason" required minLength={3} />}
          </FormField>
          <Button type="submit" size="sm" disabled={pending}>
            {t('setOverride')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function ClearOverrideForm({
  realTenantId,
  featureKey,
}: {
  realTenantId: string;
  featureKey: string;
}) {
  const t = useTranslations('admin');
  return (
    <ActionForm
      action={clearOverrideAction}
      hidden={{ realTenantId, featureKey }}
      errors="adminError"
    >
      {(pending) => (
        <Button type="submit" size="sm" variant="ghost" disabled={pending}>
          {t('clearOverrideFor', { feature: featureKey })}
        </Button>
      )}
    </ActionForm>
  );
}
