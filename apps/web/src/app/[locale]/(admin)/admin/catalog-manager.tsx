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
import { DetailTile } from '@/components/detail-tile';
import { FormField } from '@/components/form-field';
import { LimitValueFields } from '@/components/limit-value-fields';
import { SectionCard } from '@/components/section-card';
import { ToneBadge } from '@/components/tone-badge';
import { useServerAction } from '@/components/use-server-action';
import {
  addModuleFeatureAction,
  addPlanModuleAction,
  createModuleAction,
  createPlanAction,
  removeModuleFeatureAction,
  removePlanModuleAction,
  setPlanLimitAction,
  updateModuleAction,
  updatePlanAction,
} from './catalog-actions';
import { STATUS_TONE } from './catalog-tones';

const iconButton =
  'rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40';
const dangerButton = cn(
  iconButton,
  'text-destructive hover:bg-destructive/10 hover:text-destructive',
);

function NameFields({ nameEs, nameEn }: { nameEs?: string; nameEn?: string }) {
  const t = useTranslations('catalog');
  return (
    <>
      <FormField label={t('nameEs')} required>
        {(props) => <Input {...props} name="nameEs" defaultValue={nameEs} required autoFocus />}
      </FormField>
      <FormField label={t('nameEn')} required>
        {(props) => <Input {...props} name="nameEn" defaultValue={nameEn} required />}
      </FormField>
    </>
  );
}

function KeyField() {
  const t = useTranslations('catalog');
  return (
    <FormField label={t('key')} hint={t('keyHint')} required>
      {(props) => (
        <Input
          {...props}
          name="key"
          required
          pattern="[A-Za-z][A-Za-z0-9_]{2,39}"
          className="font-mono uppercase"
          autoComplete="off"
        />
      )}
    </FormField>
  );
}

function SwitchField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const uid = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p id={`${uid}-label`} className="text-sm font-medium">
          {label}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-labelledby={`${uid}-label`} />
    </div>
  );
}

export function NewPlanButton() {
  const t = useTranslations('catalog');
  const [open, setOpen] = useState(false);
  const [selfService, setSelfService] = useState(true);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" aria-hidden />
        {t('newPlan')}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('newPlan')}
        description={t('newPlanDescription')}
        submitLabel={t('create')}
        action={createPlanAction}
        errors="catalogError"
        success={t('planCreated')}
        extra={selfService ? { selfService: 'on' } : {}}
      >
        <KeyField />
        <NameFields />
        <SwitchField
          label={t('selfService')}
          hint={t('selfServiceHint')}
          checked={selfService}
          onChange={setSelfService}
        />
      </FormDialog>
    </>
  );
}

export function NewModuleButton() {
  const t = useTranslations('catalog');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" aria-hidden />
        {t('newModule')}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('newModule')}
        description={t('newModuleDescription')}
        submitLabel={t('create')}
        action={createModuleAction}
        errors="catalogError"
        success={t('moduleCreated')}
      >
        <KeyField />
        <NameFields />
      </FormDialog>
    </>
  );
}

export type PlanEditorView = {
  key: string;
  nameEs: string;
  nameEn: string;
  status: string;
  selfService: boolean;
  statusOptions: Choice[];
  modules: {
    key: string;
    name: string;
    isBase: boolean;
    comingSoon: boolean;
    leaves: string | null;
  }[];
  addable: Choice[];
  limits: {
    key: string;
    label: string;
    value: string;
    raw: number | null;
    pending: string | null;
  }[];
};

export function PlanEditor({ plan }: { plan: PlanEditorView }) {
  const t = useTranslations('catalog');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [limit, setLimit] = useState<PlanEditorView['limits'][number] | null>(null);
  const [removing, setRemoving] = useState<{ key: string; name: string } | null>(null);
  const draft = plan.status === 'DRAFT';
  const remove = useServerAction(removePlanModuleAction, {
    errors: 'catalogError',
    success: draft ? t('moduleRemoved') : t('moduleRemovalScheduled'),
    onDone: () => setRemoving(null),
  });
  const keep = useServerAction(addPlanModuleAction, {
    errors: 'catalogError',
    success: t('moduleKept'),
  });

  return (
    <div className="space-y-4">
      <SectionCard
        title={t('details')}
        action={
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="mr-1.5 h-4 w-4" aria-hidden />
            {t('edit')}
          </Button>
        }
      >
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <DetailTile label={t('nameEs')} value={plan.nameEs} />
          <DetailTile label={t('nameEn')} value={plan.nameEn} />
          <DetailTile
            label={t('status')}
            value={
              <ToneBadge tone={STATUS_TONE[plan.status] ?? 'neutral'}>
                {t(`statuses.${plan.status}`)}
              </ToneBadge>
            }
          />
          <DetailTile label={t('selfService')} value={plan.selfService ? t('yes') : t('no')} />
        </dl>
      </SectionCard>

      <SectionCard
        title={t('modulesTitle')}
        description={draft ? t('modulesDraft') : t('modulesNotice')}
        action={
          plan.addable.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              {t('addModule')}
            </Button>
          ) : undefined
        }
      >
        <ul className="divide-y divide-border" aria-label={t('modulesTitle')}>
          {plan.modules.map((module) => (
            <li
              key={module.key}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{module.name}</span>
                {module.isBase && <ToneBadge tone="primary">{t('base')}</ToneBadge>}
                {module.comingSoon && (
                  <ToneBadge tone="neutral">{t('statuses.COMING_SOON')}</ToneBadge>
                )}
                {module.leaves && (
                  <ToneBadge tone="danger">{t('leaves', { date: module.leaves })}</ToneBadge>
                )}
              </span>
              {!module.isBase &&
                (module.leaves ? (
                  <button
                    type="button"
                    disabled={keep.pending}
                    onClick={() => keep.run({ planKey: plan.key, moduleKey: module.key })}
                    title={t('keepModule', { name: module.name })}
                    aria-label={t('keepModule', { name: module.name })}
                    className={iconButton}
                  >
                    <Undo2 className="h-4 w-4" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRemoving({ key: module.key, name: module.name })}
                    title={t('removeModule', { name: module.name })}
                    aria-label={t('removeModule', { name: module.name })}
                    className={dangerButton}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                ))}
            </li>
          ))}
        </ul>
        {keep.error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {keep.error}
          </p>
        )}
      </SectionCard>

      <SectionCard
        title={t('limitsTitle')}
        description={draft ? t('limitsDraft') : t('limitsNotice')}
      >
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {plan.limits.map((row) => (
            <DetailTile
              key={row.key}
              label={row.label}
              value={row.value}
              detail={row.pending}
              onEdit={() => setLimit(row)}
              editLabel={t('editLimit', { limit: row.label })}
            />
          ))}
        </dl>
      </SectionCard>

      {editing && <PlanDetailsDialog plan={plan} onClose={() => setEditing(false)} />}
      <AddDialog
        open={adding}
        onClose={() => setAdding(false)}
        title={t('addModule')}
        description={draft ? t('modulesDraft') : t('addModuleNow')}
        label={t('module')}
        options={plan.addable}
        action={addPlanModuleAction}
        field="moduleKey"
        extra={{ planKey: plan.key }}
        success={t('moduleAdded')}
      />
      {limit && (
        <FormDialog
          open
          onOpenChange={(open) => !open && setLimit(null)}
          title={t('editLimit', { limit: limit.label })}
          description={draft ? t('limitsDraft') : t('limitsNotice')}
          submitLabel={t('save')}
          action={setPlanLimitAction}
          errors="catalogError"
          success={t('limitSaved')}
          extra={{ planKey: plan.key, featureKey: limit.key }}
        >
          <LimitValueFields label={limit.label} value={limit.raw} />
        </FormDialog>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            remove.clearError();
          }
        }}
        title={t('removeModuleTitle')}
        description={draft ? t('removeModuleDraft') : t('removeModuleNotice')}
        detail={removing?.name}
        confirmLabel={t('remove')}
        destructive
        pending={remove.pending}
        error={remove.error}
        onConfirm={() => removing && remove.run({ planKey: plan.key, moduleKey: removing.key })}
      />
    </div>
  );
}

function PlanDetailsDialog({ plan, onClose }: { plan: PlanEditorView; onClose: () => void }) {
  const t = useTranslations('catalog');
  const [status, setStatus] = useState(plan.status);
  const [selfService, setSelfService] = useState(plan.selfService);
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('editPlan')}
      submitLabel={t('save')}
      action={updatePlanAction}
      errors="catalogError"
      success={t('saved')}
      extra={{ key: plan.key, status, ...(selfService ? { selfService: 'on' } : {}) }}
    >
      <NameFields nameEs={plan.nameEs} nameEn={plan.nameEn} />
      <FormField label={t('status')} hint={t('planStatusHint')} required>
        {(props) => (
          <ChoiceSelect
            value={status}
            onChange={setStatus}
            options={plan.statusOptions}
            a11y={props}
          />
        )}
      </FormField>
      <SwitchField
        label={t('selfService')}
        hint={t('selfServiceHint')}
        checked={selfService}
        onChange={setSelfService}
      />
    </FormDialog>
  );
}

export type ModuleEditorView = {
  key: string;
  nameEs: string;
  nameEn: string;
  status: string;
  isBase: boolean;
  statusOptions: Choice[];
  features: { key: string; leaves: string | null }[];
  addable: Choice[];
};

export function ModuleEditor({ module }: { module: ModuleEditorView }) {
  const t = useTranslations('catalog');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const soon = module.status === 'COMING_SOON';
  const remove = useServerAction(removeModuleFeatureAction, {
    errors: 'catalogError',
    success: soon ? t('featureRemoved') : t('featureRemovalScheduled'),
    onDone: () => setRemoving(null),
  });
  const keep = useServerAction(addModuleFeatureAction, {
    errors: 'catalogError',
    success: t('featureKept'),
  });

  return (
    <div className="space-y-4">
      <SectionCard
        title={t('details')}
        action={
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="mr-1.5 h-4 w-4" aria-hidden />
            {t('edit')}
          </Button>
        }
      >
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <DetailTile label={t('nameEs')} value={module.nameEs} />
          <DetailTile label={t('nameEn')} value={module.nameEn} />
          <DetailTile
            label={t('status')}
            value={
              <ToneBadge tone={STATUS_TONE[module.status] ?? 'neutral'}>
                {t(`statuses.${module.status}`)}
              </ToneBadge>
            }
          />
          {module.isBase && <DetailTile label={t('base')} value={t('baseHint')} />}
        </dl>
      </SectionCard>

      <SectionCard
        title={t('featuresTitle')}
        description={soon ? t('featuresSoon') : t('featuresNotice')}
        action={
          module.addable.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              {t('addFeature')}
            </Button>
          ) : undefined
        }
      >
        {module.features.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noFeatures')}</p>
        ) : (
          <ul className="divide-y divide-border" aria-label={t('featuresTitle')}>
            {module.features.map((feature) => (
              <li
                key={feature.key}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{feature.key}</span>
                  {feature.leaves && (
                    <ToneBadge tone="danger">{t('leaves', { date: feature.leaves })}</ToneBadge>
                  )}
                </span>
                {feature.leaves ? (
                  <button
                    type="button"
                    disabled={keep.pending}
                    onClick={() => keep.run({ moduleKey: module.key, featureKey: feature.key })}
                    title={t('keepFeature', { feature: feature.key })}
                    aria-label={t('keepFeature', { feature: feature.key })}
                    className={iconButton}
                  >
                    <Undo2 className="h-4 w-4" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRemoving(feature.key)}
                    title={t('removeFeature', { feature: feature.key })}
                    aria-label={t('removeFeature', { feature: feature.key })}
                    className={dangerButton}
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

      {editing && <ModuleDetailsDialog module={module} onClose={() => setEditing(false)} />}
      <AddDialog
        open={adding}
        onClose={() => setAdding(false)}
        title={t('addFeature')}
        description={t('addFeatureNow')}
        label={t('feature')}
        options={module.addable}
        action={addModuleFeatureAction}
        field="featureKey"
        extra={{ moduleKey: module.key }}
        success={t('featureAdded')}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            remove.clearError();
          }
        }}
        title={t('removeFeatureTitle')}
        description={soon ? t('removeFeatureSoon') : t('removeFeatureNotice')}
        detail={removing ?? undefined}
        confirmLabel={t('remove')}
        destructive
        pending={remove.pending}
        error={remove.error}
        onConfirm={() => removing && remove.run({ moduleKey: module.key, featureKey: removing })}
      />
    </div>
  );
}

function ModuleDetailsDialog({
  module,
  onClose,
}: {
  module: ModuleEditorView;
  onClose: () => void;
}) {
  const t = useTranslations('catalog');
  const [status, setStatus] = useState(module.status);
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('editModule')}
      submitLabel={t('save')}
      action={updateModuleAction}
      errors="catalogError"
      success={t('saved')}
      extra={{ key: module.key, status }}
    >
      <NameFields nameEs={module.nameEs} nameEn={module.nameEn} />
      <FormField label={t('status')} hint={t('moduleStatusHint')} required>
        {(props) => (
          <ChoiceSelect
            value={status}
            onChange={setStatus}
            options={module.statusOptions}
            a11y={props}
            disabled={module.statusOptions.length < 2}
          />
        )}
      </FormField>
    </FormDialog>
  );
}

function AddDialog({
  open,
  onClose,
  title,
  description,
  label,
  options,
  action,
  field,
  extra,
  success,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  label: string;
  options: Choice[];
  action: Parameters<typeof FormDialog>[0]['action'];
  field: string;
  extra: Record<string, string>;
  success: string;
}) {
  const t = useTranslations('catalog');
  const [value, setValue] = useState(options[0]?.value ?? '');
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={title}
      description={description}
      submitLabel={t('add')}
      action={action}
      errors="catalogError"
      success={success}
      extra={{ ...extra, [field]: value || options[0]?.value || '' }}
    >
      <FormField label={label} required>
        {(props) => (
          <ChoiceSelect value={value} onChange={setValue} options={options} a11y={props} />
        )}
      </FormField>
    </FormDialog>
  );
}
