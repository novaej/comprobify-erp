'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { cn } from '@comprobify/ui/lib/utils';
import { Contact, Pencil, Plus, RotateCcw, UserX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
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
import { saveClientAction, setClientActiveAction } from './actions';

export type ClientRow = {
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

export function ClientManager({
  clients,
  idTypes,
  termUnits,
  canManage,
  searching,
}: {
  clients: ClientRow[];
  idTypes: Choice[];
  termUnits: Choice[];
  canManage: boolean;
  searching: boolean;
}) {
  const t = useTranslations('clients');
  const [editing, setEditing] = useState<ClientRow | 'new' | null>(null);
  const [toggling, setToggling] = useState<ClientRow | null>(null);
  const idLabel = new Map(idTypes.map((type) => [type.value, type.label]));
  const toggle = useServerAction(setClientActiveAction, {
    errors: 'clientsError',
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
        {clients.length === 0 ? (
          <EmptyState
            icon={Contact}
            title={searching ? t('noMatchesTitle') : t('emptyTitle')}
            description={searching ? t('noMatches') : t('empty')}
          />
        ) : (
          <StackTable aria-label={t('title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.name')}</StackHead>
                <StackHead>{t('table.identification')}</StackHead>
                <StackHead>{t('table.email')}</StackHead>
                <StackHead>{t('table.status')}</StackHead>
                {canManage && (
                  <StackHead className="pr-4 text-right">{t('table.actions')}</StackHead>
                )}
              </StackRow>
            </StackHeader>
            <StackBody>
              {clients.map((client) => (
                <StackRow key={client.id}>
                  <StackCell heading className="pl-4">
                    <p className={cn('font-medium', !client.active && 'text-muted-foreground')}>
                      {client.name}
                    </p>
                  </StackCell>
                  <StackCell label={t('table.identification')}>
                    <span className="font-mono text-sm">{client.identification}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {idLabel.get(client.idType)}
                    </span>
                  </StackCell>
                  <StackCell label={t('table.email')} className="text-sm text-muted-foreground">
                    {client.emails[0] ?? '—'}
                  </StackCell>
                  <StackCell label={t('table.status')}>
                    {client.active ? (
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
                          onClick={() => setEditing(client)}
                          title={t('edit')}
                          aria-label={t('editName', { name: client.name })}
                          className={iconButton}
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => setToggling(client)}
                          title={client.active ? t('deactivate') : t('reactivate')}
                          aria-label={
                            client.active
                              ? t('deactivateName', { name: client.name })
                              : t('reactivateName', { name: client.name })
                          }
                          className={iconButton}
                        >
                          {client.active ? (
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
        <ClientDialog
          client={editing === 'new' ? null : editing}
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

function ClientDialog({
  client,
  idTypes,
  termUnits,
  onClose,
}: {
  client: ClientRow | null;
  idTypes: Choice[];
  termUnits: Choice[];
  onClose: () => void;
}) {
  const t = useTranslations('clients');
  const [idType, setIdType] = useState(client?.idType ?? '05');
  const [unit, setUnit] = useState(client?.paymentTermUnit ?? 'dias');
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={client ? t('editName', { name: client.name }) : t('new')}
      description={t('dialogDescription')}
      submitLabel={client ? t('save') : t('create')}
      action={saveClientAction}
      errors="clientsError"
      success={client ? t('saved') : t('created')}
      extra={{ ...(client ? { id: client.id } : {}), idType, paymentTermUnit: unit }}
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
              defaultValue={client?.identification}
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
          <Input {...props} name="name" defaultValue={client?.name} required maxLength={300} />
        )}
      </FormField>
      <FormField label={t('emails')} hint={t('emailsHint')}>
        {(props) => <Input {...props} name="emails" defaultValue={client?.emails.join(', ')} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('phone')}>
          {(props) => (
            <Input
              {...props}
              name="phone"
              type="tel"
              defaultValue={client?.phone ?? ''}
              maxLength={30}
            />
          )}
        </FormField>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2">
          <FormField label={t('paymentTerm')}>
            {(props) => (
              <Input
                {...props}
                name="paymentTerm"
                type="number"
                min={1}
                step={1}
                defaultValue={client?.paymentTerm ?? ''}
              />
            )}
          </FormField>
          <FormField label={t('paymentTermUnit')}>
            {(props) => (
              <ChoiceSelect value={unit} onChange={setUnit} options={termUnits} a11y={props} />
            )}
          </FormField>
        </div>
      </div>
      <FormField label={t('address')}>
        {(props) => (
          <Input {...props} name="address" defaultValue={client?.address ?? ''} maxLength={300} />
        )}
      </FormField>
    </FormDialog>
  );
}
