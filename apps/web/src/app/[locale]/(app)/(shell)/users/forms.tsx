'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { useTranslations } from 'next-intl';
import { ActionForm } from '@/components/action-form';
import { FormField } from '@/components/form-field';
import {
  changeRoleAction,
  inviteAction,
  removeMemberAction,
  revokeInvitationAction,
  setAccessAction,
} from './actions';

const ASSIGNABLE = ['ADMIN', 'SALES', 'PURCHASING', 'ACCOUNTANT', 'VIEWER'] as const;
const selectClass =
  'h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

function RoleSelect({
  name,
  defaultValue,
  label,
}: {
  name: string;
  defaultValue?: string;
  label: string;
}) {
  const tRoles = useTranslations('roles');
  return (
    <select
      name={name}
      defaultValue={defaultValue ?? 'SALES'}
      aria-label={label}
      className={selectClass}
    >
      {ASSIGNABLE.map((role) => (
        <option key={role} value={role}>
          {tRoles(role)}
        </option>
      ))}
    </select>
  );
}

export function InviteForm() {
  const t = useTranslations('users');
  return (
    <ActionForm
      action={inviteAction}
      errors="usersError"
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      {(pending) => (
        <>
          <FormField label={t('email')} className="flex-1">
            {(props) => <Input {...props} name="email" type="email" required disabled={pending} />}
          </FormField>
          <RoleSelect name="role" label={t('role')} />
          <Button type="submit" disabled={pending}>
            {pending ? t('inviting') : t('invite')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function RoleForm({ userId, role, name }: { userId: string; role: string; name: string }) {
  const t = useTranslations('users');
  return (
    <ActionForm
      action={changeRoleAction}
      hidden={{ userId }}
      errors="usersError"
      className="flex items-center gap-2"
    >
      {(pending) => (
        <>
          <RoleSelect name="role" defaultValue={role} label={t('roleFor', { name })} />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {t('saveRole')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function RemoveForm({ userId, name }: { userId: string; name: string }) {
  const t = useTranslations('users');
  return (
    <ActionForm action={removeMemberAction} hidden={{ userId }} errors="usersError">
      {(pending) => (
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-label={t('removeName', { name })}
        >
          {t('remove')}
        </Button>
      )}
    </ActionForm>
  );
}

export function RevokeForm({ invitationId, email }: { invitationId: string; email: string }) {
  const t = useTranslations('users');
  return (
    <ActionForm action={revokeInvitationAction} hidden={{ invitationId }} errors="usersError">
      {(pending) => (
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-label={t('revokeFor', { email })}
        >
          {t('revoke')}
        </Button>
      )}
    </ActionForm>
  );
}

// FR-ROLE-2: nothing checked means every issue point.
export function AccessForm({
  userId,
  name,
  points,
  selected,
}: {
  userId: string;
  name: string;
  points: { code: string; label: string }[];
  selected: string[];
}) {
  const t = useTranslations('users');
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        {t('issuePointsFor', { name })}
      </summary>
      <ActionForm action={setAccessAction} hidden={{ userId }} errors="usersError" className="mt-2">
        {(pending) => (
          <>
            <p className="text-xs text-muted-foreground">{t('issuePointsHint')}</p>
            {points.map((point) => (
              <label key={point.code} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="points"
                  value={point.code}
                  defaultChecked={selected.includes(point.code)}
                  className="h-4 w-4 accent-primary"
                />
                {point.label}
              </label>
            ))}
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {t('saveIssuePoints')}
            </Button>
          </>
        )}
      </ActionForm>
    </details>
  );
}
