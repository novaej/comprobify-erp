'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { cn } from '@comprobify/ui/lib/utils';
import { Pencil, Plus, RotateCcw, Truck, UserX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { SortHead, type ListSorting } from '@/components/sort-head';
import {
  StackBody,
  StackCell,
  StackHead,
  StackHeader,
  StackRow,
  StackTable,
  TableCard,
} from '@/components/stack-table';
import { ToneBadge } from '@/components/tone-badge';
import { useServerAction } from '@/components/use-server-action';
import { saveProviderAction, setProviderActiveAction } from './actions';

export type ProviderRow = {
  id: string;
  idType: string;
  identification: string;
  name: string;
  emails: string[];
  phone: string | null;
  address: string | null;
  paymentTerm: number | null;
  paymentTermUnit: string | null;
  active: boolean;
};

const iconButton =
  'rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40';

export function ProviderManager({
  providers,
  idTypes,
  termUnits,
  canManage,
  searching,
  sorting,
}: {
  providers: ProviderRow[];
  idTypes: Choice[];
  termUnits: Choice[];
  canManage: boolean;
  searching: boolean;
  sorting: ListSorting;
}) {
  const t = useTranslations('providers');
  const tList = useTranslations('listToolbar');
  const [editing, setEditing] = useState<ProviderRow | 'new' | null>(null);
  const [toggling, setToggling] = useState<ProviderRow | null>(null);
  const idLabel = new Map(idTypes.map((type) => [type.value, type.label]));
  const toggle = useServerAction(setProviderActiveAction, {
    errors: 'providersError',
    success: toggling?.active ? t('deactivated') : t('reactivated'),
    onDone: () => setToggling(null),
  });

  return (
    <>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            {t('new')}
          </Button>
        </div>
      )}
      <TableCard>
        {providers.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={searching ? t('noMatchesTitle') : t('emptyTitle')}
            description={searching ? t('noMatches') : t('empty')}
          />
        ) : (
          <StackTable aria-label={t('title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <SortHead
                  {...sorting}
                  column="name"
                  label={t('table.name')}
                  actionLabel={tList('sortBy', { column: t('table.name') })}
                  className="pl-4"
                />
                <SortHead
                  {...sorting}
                  column="identification"
                  label={t('table.identification')}
                  actionLabel={tList('sortBy', { column: t('table.identification') })}
                />
                <StackHead>{t('table.email')}</StackHead>
                <StackHead>{t('table.status')}</StackHead>
                {canManage && (
                  <StackHead className="pr-4 text-right">{t('table.actions')}</StackHead>
                )}
              </StackRow>
            </StackHeader>
            <StackBody>
              {providers.map((provider) => (
                <StackRow key={provider.id}>
                  <StackCell heading className="pl-4">
                    <p className={cn('font-medium', !provider.active && 'text-muted-foreground')}>
                      {provider.name}
                    </p>
                  </StackCell>
                  <StackCell label={t('table.identification')}>
                    <span className="font-mono text-sm">{provider.identification}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {idLabel.get(provider.idType)}
                    </span>
                  </StackCell>
                  <StackCell label={t('table.email')} className="text-sm text-muted-foreground">
                    {provider.emails[0] ?? '—'}
                  </StackCell>
                  <StackCell label={t('table.status')}>
                    {provider.active ? (
                      <ToneBadge tone="success">{t('active')}</ToneBadge>
                    ) : (
                      <ToneBadge tone="neutral">{t('inactive')}</ToneBadge>
                    )}
                  </StackCell>
                  {canManage && (
                    <StackCell className="pr-4">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => setEditing(provider)}
                          title={t('edit')}
                          aria-label={t('editName', { name: provider.name })}
                          className={iconButton}
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => setToggling(provider)}
                          title={provider.active ? t('deactivate') : t('reactivate')}
                          aria-label={
                            provider.active
                              ? t('deactivateName', { name: provider.name })
                              : t('reactivateName', { name: provider.name })
                          }
                          className={iconButton}
                        >
                          {provider.active ? (
                            <UserX className="h-4 w-4" aria-hidden />
                          ) : (
                            <RotateCcw className="h-4 w-4" aria-hidden />
                          )}
                        </button>
                      </div>
                    </StackCell>
                  )}
                </StackRow>
              ))}
            </StackBody>
          </StackTable>
        )}
      </TableCard>

      {editing && (
        <ProviderDialog
          provider={editing === 'new' ? null : editing}
          idTypes={idTypes}
          termUnits={termUnits}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(open) => {
          if (!open) {
            setToggling(null);
            toggle.clearError();
          }
        }}
        title={toggling?.active ? t('deactivateTitle') : t('reactivateTitle')}
        description={toggling?.active ? t('deactivateDescription') : t('reactivateDescription')}
        detail={toggling?.name}
        confirmLabel={toggling?.active ? t('deactivate') : t('reactivate')}
        destructive={toggling?.active}
        pending={toggle.pending}
        error={toggle.error}
        onConfirm={() =>
          toggling && toggle.run({ id: toggling.id, active: String(!toggling.active) })
        }
      />
    </>
  );
}

function ProviderDialog({
  provider,
  idTypes,
  termUnits,
  onClose,
}: {
  provider: ProviderRow | null;
  idTypes: Choice[];
  termUnits: Choice[];
  onClose: () => void;
}) {
  const t = useTranslations('providers');
  const [idType, setIdType] = useState(provider?.idType ?? '04');
  const [unit, setUnit] = useState(provider?.paymentTermUnit ?? 'dias');
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={provider ? t('editName', { name: provider.name }) : t('new')}
      description={t('dialogDescription')}
      submitLabel={provider ? t('save') : t('create')}
      action={saveProviderAction}
      errors="providersError"
      success={provider ? t('saved') : t('created')}
      extra={{ ...(provider ? { id: provider.id } : {}), idType, paymentTermUnit: unit }}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <FormField label={t('idType')} required>
          {(props) => (
            <ChoiceSelect value={idType} onChange={setIdType} options={idTypes} a11y={props} />
          )}
        </FormField>
        <FormField label={t('identification')} hint={t(`identificationHint.${idType}`)} required>
          {(props) => (
            <Input
              {...props}
              name="identification"
              defaultValue={provider?.identification}
              required
              maxLength={20}
              autoComplete="off"
              inputMode={idType === '04' || idType === '05' ? 'numeric' : undefined}
            />
          )}
        </FormField>
      </div>
      <FormField label={t('name')} required>
        {(props) => (
          <Input {...props} name="name" defaultValue={provider?.name} required maxLength={300} />
        )}
      </FormField>
      <FormField label={t('emails')} hint={t('emailsHint')}>
        {(props) => <Input {...props} name="emails" defaultValue={provider?.emails.join(', ')} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={t('phone')}>
          {(props) => (
            <Input
              {...props}
              name="phone"
              type="tel"
              defaultValue={provider?.phone ?? ''}
              maxLength={30}
            />
          )}
        </FormField>
        <FormField label={t('paymentTerm')}>
          {(props) => (
            <Input
              {...props}
              name="paymentTerm"
              type="number"
              min={1}
              step={1}
              defaultValue={provider?.paymentTerm ?? ''}
            />
          )}
        </FormField>
        <FormField label={t('paymentTermUnit')}>
          {(props) => (
            <ChoiceSelect value={unit} onChange={setUnit} options={termUnits} a11y={props} />
          )}
        </FormField>
      </div>
      <FormField label={t('address')}>
        {(props) => (
          <Input {...props} name="address" defaultValue={provider?.address ?? ''} maxLength={300} />
        )}
      </FormField>
    </FormDialog>
  );
}
