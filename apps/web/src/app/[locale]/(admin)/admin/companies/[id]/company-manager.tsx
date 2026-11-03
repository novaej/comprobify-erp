'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Switch } from '@comprobify/ui/components/switch';
import { cn } from '@comprobify/ui/lib/utils';
import { Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import { ToneBadge } from '@/components/tone-badge';
import { useServerAction } from '@/components/use-server-action';
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

export type CompanyView = {
  realTenantId: string;
  plan: { key: string; name: string; custom: boolean };
  billing: { complimentary: boolean; reason: string | null };
  price: string | null;
  plans: Choice[];
  modules: Choice[];
  addOns: { key: string; name: string; removesAt: string | null }[];
  limits: { key: string; label: string; resolved: string; own: number | null | undefined }[];
  overrides: { key: string; value: string; reason: string }[];
  features: { key: string; kind: 'BOOLEAN' | 'LIMIT' }[];
  active: string[];
};

const iconButton =
  'rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40';

type Dialogs =
  | { kind: 'plan' }
  | { kind: 'billing' }
  | { kind: 'price' }
  | { kind: 'module' }
  | { kind: 'limit'; key: string; label: string; own: number | null | undefined }
  | { kind: 'override' }
  | null;

export function CompanyManager({ company }: { company: CompanyView }) {
  const t = useTranslations('admin');
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [removing, setRemoving] = useState<{ key: string; name: string } | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  const close = () => setDialog(null);
  const id = { realTenantId: company.realTenantId };

  const remove = useServerAction(removeModuleAction, {
    errors: 'adminError',
    success: t('moduleRemovalScheduled'),
    onDone: () => setRemoving(null),
  });
  const keep = useServerAction(addModuleAction, { errors: 'adminError', success: t('moduleKept') });
  const clearOverride = useServerAction(clearOverrideAction, {
    errors: 'adminError',
    success: t('overrideCleared'),
    onDone: () => setClearing(null),
  });

  return (
    <div className="space-y-4">
      <SectionCard
        title={t('planTitle')}
        action={
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'plan' })}>
            {t('changePlan')}
          </Button>
        }
      >
        <p className="text-2xl font-semibold tracking-tight">{company.plan.name}</p>
        <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Tile
            label={t('billing')}
            value={company.billing.complimentary ? t('complimentary') : t('paid')}
            detail={company.billing.reason}
            onEdit={() => setDialog({ kind: 'billing' })}
            editLabel={t('changeBilling')}
          />
          {company.plan.custom && (
            <Tile
              label={t('monthlyPrice')}
              value={company.price ? `$${company.price}` : t('noPrice')}
              onEdit={() => setDialog({ kind: 'price' })}
              editLabel={t('changePrice')}
            />
          )}
        </dl>
      </SectionCard>

      <SectionCard
        title={t('addOnsTitle')}
        description={t('addOnsDescription')}
        action={
          company.modules.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'module' })}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              {t('addModule')}
            </Button>
          ) : undefined
        }
      >
        {company.addOns.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noAddOns')}</p>
        ) : (
          <ul className="divide-y divide-border" aria-label={t('addOnsTitle')}>
            {company.addOns.map((module) => (
              <li
                key={module.key}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{module.name}</span>
                  {module.removesAt && (
                    <ToneBadge tone="danger">
                      {t('removesAt', { date: module.removesAt })}
                    </ToneBadge>
                  )}
                </span>
                {module.removesAt ? (
                  <button
                    type="button"
                    disabled={keep.pending}
                    onClick={() => keep.run({ ...id, moduleKey: module.key })}
                    title={t('keepModuleFor', { name: module.name })}
                    aria-label={t('keepModuleFor', { name: module.name })}
                    className={iconButton}
                  >
                    <Undo2 className="h-4 w-4" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRemoving({ key: module.key, name: module.name })}
                    title={t('removeModuleFor', { name: module.name })}
                    aria-label={t('removeModuleFor', { name: module.name })}
                    className={cn(
                      iconButton,
                      'text-destructive hover:bg-destructive/10 hover:text-destructive',
                    )}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {keep.error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {keep.error}
          </p>
        )}
      </SectionCard>

      <SectionCard
        title={t('limitsTitle')}
        description={company.plan.custom ? t('limitsCustom') : t('limitsPlan')}
      >
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {company.limits.map((limit) => (
            <Tile
              key={limit.key}
              label={limit.label}
              value={limit.resolved}
              detail={limit.own !== undefined ? t('ownValue') : null}
              onEdit={
                company.plan.custom
                  ? () =>
                      setDialog({
                        kind: 'limit',
                        key: limit.key,
                        label: limit.label,
                        own: limit.own,
                      })
                  : undefined
              }
              editLabel={t('editLimit', { limit: limit.label })}
            />
          ))}
        </dl>
      </SectionCard>

      <SectionCard
        title={t('overridesTitle')}
        description={t('overridesDescription')}
        action={
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'override' })}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            {t('addOverride')}
          </Button>
        }
      >
        {company.overrides.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noOverrides')}</p>
        ) : (
          <ul className="divide-y divide-border" aria-label={t('overridesTitle')}>
            {company.overrides.map((override) => (
              <li
                key={override.key}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{override.key}</span>
                  <ToneBadge tone="info">{override.value}</ToneBadge>
                  <span className="text-muted-foreground">{override.reason}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setClearing(override.key)}
                  title={t('clearOverrideFor', { feature: override.key })}
                  aria-label={t('clearOverrideFor', { feature: override.key })}
                  className={cn(
                    iconButton,
                    'text-destructive hover:bg-destructive/10 hover:text-destructive',
                  )}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={t('resolvedTitle')} description={t('resolvedDescription')}>
        <ul className="flex flex-wrap gap-1.5" aria-label={t('resolvedTitle')}>
          {company.active.map((key) => (
            <li key={key}>
              <ToneBadge tone="neutral" className="font-mono">
                {key}
              </ToneBadge>
            </li>
          ))}
        </ul>
      </SectionCard>

      <PlanDialog company={company} open={dialog?.kind === 'plan'} onClose={close} />
      <BillingDialog company={company} open={dialog?.kind === 'billing'} onClose={close} />
      <FormDialog
        open={dialog?.kind === 'price'}
        onOpenChange={(open) => !open && close()}
        title={t('changePrice')}
        description={t('priceDescription')}
        submitLabel={t('save')}
        action={setPriceAction}
        errors="adminError"
        success={t('priceSaved')}
        extra={id}
      >
        <FormField label={t('monthlyPrice')} hint={t('priceHint')}>
          {(props) => (
            <Input
              {...props}
              name="monthlyPrice"
              inputMode="decimal"
              pattern="\d{1,10}(\.\d{1,2})?"
              defaultValue={company.price ?? ''}
              autoFocus
            />
          )}
        </FormField>
      </FormDialog>
      <ModuleDialog company={company} open={dialog?.kind === 'module'} onClose={close} />
      {dialog?.kind === 'limit' && <LimitDialog company={company} limit={dialog} onClose={close} />}
      <OverrideDialog company={company} open={dialog?.kind === 'override'} onClose={close} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            remove.clearError();
          }
        }}
        title={t('removeModuleTitle')}
        description={t('removeModuleDescription')}
        detail={removing?.name}
        confirmLabel={t('removeModule')}
        destructive
        pending={remove.pending}
        error={remove.error}
        onConfirm={() => removing && remove.run({ ...id, moduleKey: removing.key })}
      />
      <ConfirmDialog
        open={clearing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setClearing(null);
            clearOverride.clearError();
          }
        }}
        title={t('clearOverrideTitle')}
        description={t('clearOverrideDescription')}
        detail={clearing ?? undefined}
        confirmLabel={t('clearOverride')}
        destructive
        pending={clearOverride.pending}
        error={clearOverride.error}
        onConfirm={() => clearing && clearOverride.run({ ...id, featureKey: clearing })}
      />
    </div>
  );
}

// A <dl> row: the edit button lives in the <dd>, the only place a list allows it.
function Tile({
  label,
  value,
  detail,
  onEdit,
  editLabel,
}: {
  label: string;
  value: string;
  detail?: string | null;
  onEdit?: () => void;
  editLabel: string;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 text-sm font-medium">
        {value}
        {detail && <span className="text-xs font-normal text-muted-foreground">({detail})</span>}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            title={editLabel}
            aria-label={editLabel}
            className={iconButton}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
        )}
      </dd>
    </div>
  );
}

function PlanDialog({
  company,
  open,
  onClose,
}: {
  company: CompanyView;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('admin');
  const [plan, setPlan] = useState(company.plan.key);
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('changePlan')}
      description={t('changePlanDescription')}
      submitLabel={t('changePlan')}
      action={changePlanAction}
      errors="adminError"
      success={t('planChanged')}
      extra={{ realTenantId: company.realTenantId, planKey: plan }}
    >
      <FormField label={t('plan')} required>
        {(props) => (
          <ChoiceSelect value={plan} onChange={setPlan} options={company.plans} a11y={props} />
        )}
      </FormField>
    </FormDialog>
  );
}

function BillingDialog({
  company,
  open,
  onClose,
}: {
  company: CompanyView;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('admin');
  const uid = useId();
  const [complimentary, setComplimentary] = useState(company.billing.complimentary);
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('changeBilling')}
      submitLabel={t('save')}
      action={setBillingAction}
      errors="adminError"
      success={t('billingSaved')}
      extra={{
        realTenantId: company.realTenantId,
        ...(complimentary ? { complimentary: 'on' } : {}),
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p id={`${uid}-label`} className="text-sm font-medium">
            {t('complimentary')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('complimentaryHint')}</p>
        </div>
        <Switch
          checked={complimentary}
          onCheckedChange={setComplimentary}
          aria-labelledby={`${uid}-label`}
        />
      </div>
      {complimentary && (
        <FormField label={t('reason')} required>
          {(props) => (
            <Input
              {...props}
              name="reason"
              defaultValue={company.billing.reason ?? ''}
              required
              minLength={3}
            />
          )}
        </FormField>
      )}
    </FormDialog>
  );
}

function ModuleDialog({
  company,
  open,
  onClose,
}: {
  company: CompanyView;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('admin');
  const [module, setModule] = useState(company.modules[0]?.value ?? '');
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('addModule')}
      description={t('addModuleDescription')}
      submitLabel={t('addModule')}
      action={addModuleAction}
      errors="adminError"
      success={t('moduleAdded')}
      extra={{ realTenantId: company.realTenantId, moduleKey: module }}
    >
      <FormField label={t('module')} required>
        {(props) => (
          <ChoiceSelect
            value={module}
            onChange={setModule}
            options={company.modules}
            a11y={props}
          />
        )}
      </FormField>
    </FormDialog>
  );
}

function ValueFields({ label, value }: { label: string; value?: number | null }) {
  const t = useTranslations('admin');
  const [unlimited, setUnlimited] = useState(value === null);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <FormField label={label} className="flex-1">
        {(props) => (
          <Input
            {...props}
            name="value"
            type="number"
            min={0}
            step={1}
            defaultValue={value ?? ''}
            disabled={unlimited}
            required={!unlimited}
          />
        )}
      </FormField>
      <label className="flex h-8 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="unlimited"
          checked={unlimited}
          onChange={(event) => setUnlimited(event.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        {t('unlimited')}
      </label>
    </div>
  );
}

function LimitDialog({
  company,
  limit,
  onClose,
}: {
  company: CompanyView;
  limit: { key: string; label: string; own: number | null | undefined };
  onClose: () => void;
}) {
  const t = useTranslations('admin');
  const reset = useServerAction(clearLimitAction, {
    errors: 'adminError',
    success: t('limitCleared'),
    onDone: onClose,
  });
  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t('editLimit', { limit: limit.label })}
      description={t('limitsCustom')}
      submitLabel={t('save')}
      action={setLimitAction}
      errors="adminError"
      success={t('limitSaved')}
      extra={{ realTenantId: company.realTenantId, featureKey: limit.key }}
    >
      <ValueFields label={limit.label} value={limit.own} />
      {limit.own !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={reset.pending}
          onClick={() => reset.run({ realTenantId: company.realTenantId, featureKey: limit.key })}
        >
          {t('usePlanValue')}
        </Button>
      )}
      {reset.error && (
        <p role="alert" className="text-sm text-destructive">
          {reset.error}
        </p>
      )}
    </FormDialog>
  );
}

function OverrideDialog({
  company,
  open,
  onClose,
}: {
  company: CompanyView;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('admin');
  const [key, setKey] = useState(company.features[0]?.key ?? '');
  const [effect, setEffect] = useState('GRANT');
  const isLimit = company.features.find((feature) => feature.key === key)?.kind === 'LIMIT';
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('addOverride')}
      description={t('overridesDescription')}
      submitLabel={t('setOverride')}
      action={setOverrideAction}
      errors="adminError"
      success={t('overrideSaved')}
      extra={{
        realTenantId: company.realTenantId,
        featureKey: key,
        effect: isLimit ? 'LIMIT' : effect,
      }}
    >
      <FormField label={t('feature')} required>
        {(props) => (
          <ChoiceSelect
            value={key}
            onChange={setKey}
            options={company.features.map((feature) => ({
              value: feature.key,
              label: feature.key,
            }))}
            a11y={props}
          />
        )}
      </FormField>
      {isLimit ? (
        <ValueFields label={t('limitValue')} />
      ) : (
        <FormField label={t('effect')} required>
          {(props) => (
            <ChoiceSelect
              value={effect}
              onChange={setEffect}
              options={[
                { value: 'GRANT', label: t('effects.GRANT') },
                { value: 'REVOKE', label: t('effects.REVOKE') },
              ]}
              a11y={props}
            />
          )}
        </FormField>
      )}
      <FormField label={t('reason')} required>
        {(props) => <Input {...props} name="reason" required minLength={3} />}
      </FormField>
    </FormDialog>
  );
}
