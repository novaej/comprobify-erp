'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Switch } from '@comprobify/ui/components/switch';
import { FileStack, Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { DetailTile } from '@/components/detail-tile';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import { ToneBadge } from '@/components/tone-badge';
import { useServerAction } from '@/components/use-server-action';
import {
  createIssuePointAction,
  saveBranchAction,
  setDocumentTypesAction,
  setNegativeStockAction,
  setPausedAction,
  updateProfileAction,
} from './actions';

export type SettingsView = {
  profile: {
    ruc: string;
    legalName: string;
    tradeName: string | null;
    mainAddress: string;
    requiredAccounting: boolean;
    specialTaxpayerResolution: string | null;
    withholdingAgentResolution: string | null;
    taxRegime: string;
  };
  negativeStock: 'BLOCK' | 'ALLOW';
  // The Inventario module, which the negative-stock rule belongs to.
  inventory: boolean;
  branches: {
    id: string;
    code: string;
    name: string;
    address: string;
    issuePoints: { id: string; code: string; canIssue: boolean; documentTypes: string[] }[];
  }[];
  regimes: Choice[];
  documentTypes: Choice[];
  // The types a builder exists for and the plan includes.
  offered: string[];
};

const iconButton =
  'rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

type Dialog =
  | { kind: 'profile' }
  | { kind: 'branch'; branch: SettingsView['branches'][number] | null }
  | { kind: 'point'; branch: SettingsView['branches'][number] }
  | {
      kind: 'types';
      branchCode: string;
      point: SettingsView['branches'][number]['issuePoints'][number];
    }
  | null;

export function SettingsManager({ settings }: { settings: SettingsView }) {
  const t = useTranslations('settings');
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const typeLabel = new Map(settings.documentTypes.map((type) => [type.value, type.label]));
  const regimeLabel = new Map(settings.regimes.map((regime) => [regime.value, regime.label]));
  const { profile } = settings;

  return (
    <div className="space-y-4">
      <SectionCard
        title={t('taxTitle')}
        description={t('taxDescription')}
        action={
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'profile' })}>
            <Pencil className="mr-1.5 h-4 w-4" aria-hidden />
            {t('edit')}
          </Button>
        }
      >
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <DetailTile label={t('ruc')} value={<span className="font-mono">{profile.ruc}</span>} />
          <DetailTile label={t('legalName')} value={profile.legalName} />
          <DetailTile label={t('tradeName')} value={profile.tradeName ?? '—'} />
          <DetailTile label={t('mainAddress')} value={profile.mainAddress} />
          <DetailTile
            label={t('requiredAccounting')}
            value={profile.requiredAccounting ? t('yes') : t('no')}
          />
          <DetailTile
            label={t('taxRegime')}
            value={regimeLabel.get(profile.taxRegime) ?? profile.taxRegime}
          />
          <DetailTile
            label={t('specialTaxpayer')}
            value={profile.specialTaxpayerResolution ?? '—'}
          />
          <DetailTile
            label={t('withholdingAgent')}
            value={profile.withholdingAgentResolution ?? '—'}
          />
        </dl>
      </SectionCard>

      <SectionCard
        title={t('branchesTitle')}
        description={t('branchesDescription')}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialog({ kind: 'branch', branch: null })}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            {t('addBranch')}
          </Button>
        }
      >
        <div className="space-y-4">
          {settings.branches.map((branch) => (
            <section
              key={branch.id}
              aria-label={t('branchLabel', { code: branch.code, name: branch.name })}
              className="rounded-lg border border-border"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className="font-mono">{branch.code}</span> · {branch.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{branch.address}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setDialog({ kind: 'branch', branch })}
                    title={t('editBranch')}
                    aria-label={t('editBranchName', { name: branch.name })}
                    className={iconButton}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDialog({ kind: 'point', branch })}
                  >
                    <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                    {t('addPoint')}
                  </Button>
                </div>
              </div>
              {branch.issuePoints.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">{t('noPoints')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {branch.issuePoints.map((point) => (
                    <PointRow
                      key={point.id}
                      branchCode={branch.code}
                      point={point}
                      typeLabel={typeLabel}
                      onTypes={() => setDialog({ kind: 'types', branchCode: branch.code, point })}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </SectionCard>

      {settings.inventory && <StockRuleCard allowed={settings.negativeStock === 'ALLOW'} />}

      {dialog?.kind === 'profile' && <ProfileDialog settings={settings} onClose={close} />}
      {dialog?.kind === 'branch' && <BranchDialog branch={dialog.branch} onClose={close} />}
      {dialog?.kind === 'point' && (
        <FormDialog
          open
          onOpenChange={(open) => !open && close()}
          title={t('addPointTo', { name: dialog.branch.name })}
          description={t('addPointDescription')}
          submitLabel={t('create')}
          action={createIssuePointAction}
          errors="settingsError"
          success={t('pointCreated')}
          extra={{ branchId: dialog.branch.id }}
        >
          <FormField label={t('pointCode')} hint={t('codeHint')} required>
            {(props) => (
              <Input
                {...props}
                name="code"
                required
                pattern="[0-9]{3}"
                maxLength={3}
                inputMode="numeric"
                autoFocus
              />
            )}
          </FormField>
        </FormDialog>
      )}
      {dialog?.kind === 'types' && (
        <TypesDialog
          branchCode={dialog.branchCode}
          point={dialog.point}
          settings={settings}
          onClose={close}
        />
      )}
    </div>
  );
}

// FR-INV-4: block by default; allowing it lets an outflow take stock below zero.
function StockRuleCard({ allowed }: { allowed: boolean }) {
  const t = useTranslations('settings');
  const uid = useId();
  const [allow, setAllow] = useState(allowed);
  const save = useServerAction(setNegativeStockAction, { errors: 'settingsError' });
  return (
    <SectionCard title={t('inventoryTitle')} description={t('inventoryDescription')}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p id={`${uid}-negative`} className="text-sm font-medium">
            {t('negativeStock')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('negativeStockHint')}</p>
        </div>
        <Switch
          checked={allow}
          disabled={save.pending}
          aria-labelledby={`${uid}-negative`}
          onCheckedChange={(next) => {
            setAllow(next);
            save.run(
              { allow: String(next) },
              { success: next ? t('negativeStockAllowed') : t('negativeStockBlocked') },
            );
          }}
        />
      </div>
      {save.error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {save.error}
        </p>
      )}
    </SectionCard>
  );
}

function PointRow({
  branchCode,
  point,
  typeLabel,
  onTypes,
}: {
  branchCode: string;
  point: SettingsView['branches'][number]['issuePoints'][number];
  typeLabel: Map<string, string>;
  onTypes: () => void;
}) {
  const t = useTranslations('settings');
  const uid = useId();
  const [canIssue, setCanIssue] = useState(point.canIssue);
  const pause = useServerAction(setPausedAction, { errors: 'settingsError' });
  const name = `${branchCode}-${point.code}`;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-mono font-medium">{name}</span>
        {point.documentTypes.length === 0 ? (
          <ToneBadge tone="neutral">{t('noTypes')}</ToneBadge>
        ) : (
          point.documentTypes.map((type) => (
            <ToneBadge key={type} tone="info">
              {typeLabel.get(type) ?? type}
            </ToneBadge>
          ))
        )}
        {!canIssue && <ToneBadge tone="warning">{t('pausedBadge')}</ToneBadge>}
      </span>
      <span className="flex items-center gap-3">
        <button
          type="button"
          onClick={onTypes}
          title={t('documentTypes')}
          aria-label={t('documentTypesFor', { point: name })}
          className={iconButton}
        >
          <FileStack className="h-4 w-4" aria-hidden />
        </button>
        <span className="flex items-center gap-2">
          <span id={`${uid}-label`} className="text-xs text-muted-foreground">
            {t('issues')}
          </span>
          <Switch
            checked={canIssue}
            disabled={pause.pending}
            aria-label={t('issuesFor', { point: name })}
            onCheckedChange={(next) => {
              setCanIssue(next);
              pause.run(
                { issuePointId: point.id, canIssue: String(next) },
                { success: next ? t('resumed') : t('paused') },
              );
            }}
          />
        </span>
      </span>
      {pause.error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {pause.error}
        </p>
      )}
    </li>
  );
}

function ProfileDialog({ settings, onClose }: { settings: SettingsView; onClose: () => void }) {
  const t = useTranslations('settings');
  const uid = useId();
  const { profile } = settings;
  const [regime, setRegime] = useState(profile.taxRegime);
  const [accounting, setAccounting] = useState(profile.requiredAccounting);
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('editTax')}
      description={t('editTaxDescription')}
      submitLabel={t('save')}
      action={updateProfileAction}
      errors="settingsError"
      success={t('saved')}
      extra={{ taxRegime: regime, ...(accounting ? { requiredAccounting: 'on' } : {}) }}
    >
      <FormField label={t('tradeName')} hint={t('tradeNameHint')}>
        {(props) => (
          <Input
            {...props}
            name="tradeName"
            defaultValue={profile.tradeName ?? ''}
            maxLength={300}
          />
        )}
      </FormField>
      <FormField label={t('mainAddress')} required>
        {(props) => (
          <Input
            {...props}
            name="mainAddress"
            defaultValue={profile.mainAddress}
            required
            maxLength={300}
          />
        )}
      </FormField>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p id={`${uid}-accounting`} className="text-sm font-medium">
            {t('requiredAccounting')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('requiredAccountingHint')}</p>
        </div>
        <Switch
          checked={accounting}
          onCheckedChange={setAccounting}
          aria-labelledby={`${uid}-accounting`}
        />
      </div>
      <FormField label={t('taxRegime')} required>
        {(props) => (
          <ChoiceSelect
            value={regime}
            onChange={setRegime}
            options={settings.regimes}
            a11y={props}
          />
        )}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('specialTaxpayer')} hint={t('specialTaxpayerHint')}>
          {(props) => (
            <Input
              {...props}
              name="specialTaxpayerResolution"
              defaultValue={profile.specialTaxpayerResolution ?? ''}
              pattern="[A-Za-z0-9]{3,13}"
              maxLength={13}
            />
          )}
        </FormField>
        <FormField label={t('withholdingAgent')} hint={t('withholdingAgentHint')}>
          {(props) => (
            <Input
              {...props}
              name="withholdingAgentResolution"
              defaultValue={profile.withholdingAgentResolution ?? ''}
              pattern="[0-9]{1,8}"
              maxLength={8}
              inputMode="numeric"
            />
          )}
        </FormField>
      </div>
    </FormDialog>
  );
}

function BranchDialog({
  branch,
  onClose,
}: {
  branch: SettingsView['branches'][number] | null;
  onClose: () => void;
}) {
  const t = useTranslations('settings');
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={branch ? t('editBranchName', { name: branch.name }) : t('addBranch')}
      description={branch ? t('editBranchDescription') : t('addBranchDescription')}
      submitLabel={branch ? t('save') : t('create')}
      action={saveBranchAction}
      errors="settingsError"
      success={branch ? t('saved') : t('branchCreated')}
      extra={branch ? { branchId: branch.id } : {}}
    >
      {!branch && (
        <FormField label={t('branchCode')} hint={t('codeHint')} required>
          {(props) => (
            <Input
              {...props}
              name="code"
              required
              pattern="[0-9]{3}"
              maxLength={3}
              inputMode="numeric"
              autoFocus
            />
          )}
        </FormField>
      )}
      <FormField label={t('branchName')} required>
        {(props) => (
          <Input {...props} name="name" defaultValue={branch?.name} required maxLength={120} />
        )}
      </FormField>
      <FormField label={t('branchAddress')} hint={t('branchAddressHint')} required>
        {(props) => (
          <Input
            {...props}
            name="address"
            defaultValue={branch?.address}
            required
            maxLength={300}
          />
        )}
      </FormField>
    </FormDialog>
  );
}

function TypesDialog({
  branchCode,
  point,
  settings,
  onClose,
}: {
  branchCode: string;
  point: SettingsView['branches'][number]['issuePoints'][number];
  settings: SettingsView;
  onClose: () => void;
}) {
  const t = useTranslations('settings');
  const uid = useId();
  // Listed: what the plan offers, plus any already enabled that it no longer does.
  const listed = [...new Set([...settings.offered, ...point.documentTypes])];
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('documentTypesFor', { point: `${branchCode}-${point.code}` })}
      description={t('documentTypesDescription')}
      submitLabel={t('save')}
      action={setDocumentTypesAction}
      errors="settingsError"
      success={t('saved')}
      extra={{
        issuePointId: point.id,
        current: point.documentTypes.join(','),
        offered: listed.join(','),
      }}
    >
      <div role="group" aria-labelledby={`${uid}-types`} className="space-y-1">
        <span id={`${uid}-types`} className="sr-only">
          {t('documentTypes')}
        </span>
        {listed.map((type) => (
          <label
            key={type}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted/60"
          >
            <input
              type="checkbox"
              name="documentTypes"
              value={type}
              defaultChecked={point.documentTypes.includes(type)}
              className="h-4 w-4 accent-primary"
            />
            {settings.documentTypes.find((choice) => choice.value === type)?.label ?? type}
            {!settings.offered.includes(type) && (
              <ToneBadge tone="warning">{t('notInPlan')}</ToneBadge>
            )}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('moreTypesSoon')}</p>
    </FormDialog>
  );
}
