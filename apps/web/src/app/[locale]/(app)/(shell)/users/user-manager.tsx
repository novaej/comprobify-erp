'use client';

import { Button, buttonVariants } from '@comprobify/ui/components/button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@comprobify/ui/components/dialog';
import { Input } from '@comprobify/ui/components/input';
import { Switch } from '@comprobify/ui/components/switch';
import { cn } from '@comprobify/ui/lib/utils';
import { Info, MailX, Pencil, Trash2, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Banner } from '@/components/banner';
import { ChoiceSelect } from '@/components/choice-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form-field';
import { ScrollDialogContent } from '@/components/scroll-dialog-content';
import {
  StackBody,
  StackCell,
  StackHead,
  StackHeader,
  StackRow,
  StackTable,
  TableCard,
} from '@/components/stack-table';
import { ToneBadge, type Tone } from '@/components/tone-badge';
import { useServerAction } from '@/components/use-server-action';
import { Link } from '@/i18n/navigation';
import {
  inviteAction,
  removeMemberAction,
  revokeInvitationAction,
  setTwoFactorRequirementAction,
  updateMemberAction,
} from './actions';

const ASSIGNABLE = ['ADMIN', 'SALES', 'PURCHASING', 'ACCOUNTANT', 'VIEWER'] as const;
// Owner and admin see every issue point, so restricting them means nothing (FR-ROLE-2).
const UNRESTRICTED = new Set(['OWNER', 'ADMIN']);
const ROLE_TONE: Record<string, Tone> = { OWNER: 'primary', ADMIN: 'info' };

export type MemberView = {
  userId: string;
  name: string;
  email: string;
  role: string;
  issuePoints: string[];
};
export type InvitationView = { id: string; email: string; role: string; expires: string };

const iconButton =
  'rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40';

export function UserManager({
  members,
  invitations,
  points,
  currentUserId,
  canManage,
  canManageOrganization,
  canSeePlan,
  seats,
  requireTwoFactor,
}: {
  members: MemberView[];
  invitations: InvitationView[];
  points: { code: string; label: string }[];
  currentUserId: string;
  canManage: boolean;
  canManageOrganization: boolean;
  canSeePlan: boolean;
  seats: { used: number; limit: number | null };
  requireTwoFactor: boolean;
}) {
  const t = useTranslations('users');
  const tRoles = useTranslations('roles');
  const atLimit = seats.limit !== null && seats.used >= seats.limit;
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<MemberView | null>(null);
  const [removing, setRemoving] = useState<MemberView | null>(null);
  const [revoking, setRevoking] = useState<InvitationView | null>(null);
  const roleOptions = ASSIGNABLE.map((role) => ({ value: role, label: tRoles(role) }));

  const remove = useServerAction(removeMemberAction, {
    errors: 'usersError',
    success: t('removed'),
    onDone: () => setRemoving(null),
  });
  const revoke = useServerAction(revokeInvitationAction, {
    errors: 'usersError',
    success: t('revoked'),
    onDone: () => setRevoking(null),
  });

  return (
    <div className="space-y-4">
      {canManage && (
        <>
          {atLimit && (
            <Banner
              tone="warning"
              icon={Info}
              role="note"
              className="mb-0"
              action={
                canSeePlan ? (
                  <Link href="/plan" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                    {t('seePlan')}
                  </Link>
                ) : undefined
              }
            >
              {t('seatsFull', { seats: seats.limit ?? 0 })}
            </Banner>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p className="text-sm text-muted-foreground">
              {seats.limit === null
                ? t('seatUsageUnlimited', { used: seats.used })
                : t('seatUsage', { used: seats.used, limit: seats.limit })}
            </p>
            <Button size="sm" onClick={() => setInviting(true)} disabled={atLimit}>
              <UserPlus className="mr-1.5 h-4 w-4" aria-hidden />
              {t('invite')}
            </Button>
          </div>
        </>
      )}

      <TableCard>
        <StackTable aria-label={t('membersTitle')}>
          <StackHeader>
            <StackRow className="bg-muted/40">
              <StackHead className="pl-4">{t('table.name')}</StackHead>
              <StackHead>{t('table.issuePoints')}</StackHead>
              <StackHead>{t('table.role')}</StackHead>
              <StackHead>{t('table.status')}</StackHead>
              {canManage && <StackHead className="pr-4 text-right">{t('table.actions')}</StackHead>}
            </StackRow>
          </StackHeader>
          <StackBody>
            {members.map((member) => {
              const editable =
                canManage && member.role !== 'OWNER' && member.userId !== currentUserId;
              return (
                <StackRow key={member.userId}>
                  <StackCell heading className="pl-4">
                    <p className="font-medium">
                      {member.name}
                      {member.userId === currentUserId && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          ({t('you')})
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </StackCell>
                  <StackCell label={t('table.issuePoints')}>
                    <IssuePoints member={member} />
                  </StackCell>
                  <StackCell label={t('table.role')} className="whitespace-nowrap">
                    <ToneBadge tone={ROLE_TONE[member.role] ?? 'neutral'}>
                      {tRoles(member.role as 'VIEWER')}
                    </ToneBadge>
                  </StackCell>
                  <StackCell label={t('table.status')} className="whitespace-nowrap">
                    <ToneBadge tone="success">{t('status.ACTIVE')}</ToneBadge>
                  </StackCell>
                  {canManage && (
                    <StackCell className="pr-4">
                      {editable && (
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            onClick={() => setEditing(member)}
                            title={t('edit')}
                            aria-label={t('editName', { name: member.name })}
                            className={iconButton}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoving(member)}
                            title={t('remove')}
                            aria-label={t('removeName', { name: member.name })}
                            className={cn(
                              iconButton,
                              'text-destructive hover:bg-destructive/10 hover:text-destructive',
                            )}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      )}
                    </StackCell>
                  )}
                </StackRow>
              );
            })}
            {canManage &&
              invitations.map((invitation) => (
                <StackRow key={invitation.id}>
                  <StackCell heading className="pl-4">
                    <p className="font-medium">{invitation.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('expires', { date: invitation.expires })}
                    </p>
                  </StackCell>
                  <StackCell label={t('table.issuePoints')}>
                    <span className="text-xs text-muted-foreground">—</span>
                  </StackCell>
                  <StackCell label={t('table.role')} className="whitespace-nowrap">
                    <ToneBadge tone="neutral">{tRoles(invitation.role as 'VIEWER')}</ToneBadge>
                  </StackCell>
                  <StackCell label={t('table.status')} className="whitespace-nowrap">
                    <ToneBadge tone="warning">{t('status.INVITED')}</ToneBadge>
                  </StackCell>
                  <StackCell className="pr-4">
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => setRevoking(invitation)}
                        title={t('revoke')}
                        aria-label={t('revokeFor', { email: invitation.email })}
                        className={cn(
                          iconButton,
                          'text-destructive hover:bg-destructive/10 hover:text-destructive',
                        )}
                      >
                        <MailX className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </StackCell>
                </StackRow>
              ))}
          </StackBody>
        </StackTable>
      </TableCard>

      {canManageOrganization && <TwoFactorRequirement required={requireTwoFactor} />}

      <InviteDialog open={inviting} onOpenChange={setInviting} roleOptions={roleOptions} />
      {editing && (
        <EditDialog
          member={editing}
          points={points}
          roleOptions={roleOptions}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            remove.clearError();
          }
        }}
        title={t('removeDialog.title')}
        description={t('removeDialog.description')}
        detail={removing ? `${removing.name} · ${removing.email}` : undefined}
        confirmLabel={t('remove')}
        destructive
        pending={remove.pending}
        error={remove.error}
        onConfirm={() => removing && remove.run({ userId: removing.userId })}
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevoking(null);
            revoke.clearError();
          }
        }}
        title={t('revokeDialog.title')}
        description={t('revokeDialog.description')}
        detail={revoking?.email}
        confirmLabel={t('revoke')}
        destructive
        pending={revoke.pending}
        error={revoke.error}
        onConfirm={() => revoking && revoke.run({ invitationId: revoking.id })}
      />
    </div>
  );
}

function IssuePoints({ member }: { member: MemberView }) {
  const t = useTranslations('users');
  if (UNRESTRICTED.has(member.role) || member.issuePoints.length === 0)
    return <ToneBadge tone="info">{t('allPoints')}</ToneBadge>;
  return (
    <div className="flex flex-wrap gap-1">
      {member.issuePoints.map((code) => (
        <ToneBadge key={code} tone="neutral" className="font-mono">
          {code}
        </ToneBadge>
      ))}
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  roleOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleOptions: { value: string; label: string }[];
}) {
  const t = useTranslations('users');
  const [role, setRole] = useState('SALES');
  const invite = useServerAction(inviteAction, {
    errors: 'usersError',
    success: t('invited'),
    onDone: () => onOpenChange(false),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) invite.clearError();
      }}
    >
      <ScrollDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('invite')}</DialogTitle>
          <DialogDescription>{t('inviteDescription')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            form.set('role', role);
            invite.run(form);
          }}
        >
          <FormField label={t('email')} required>
            {(props) => (
              <Input {...props} name="email" type="email" required autoFocus autoComplete="off" />
            )}
          </FormField>
          <FormField label={t('role')} required>
            {(props) => (
              <ChoiceSelect value={role} onChange={setRole} options={roleOptions} a11y={props} />
            )}
          </FormField>
          {invite.error && (
            <p role="alert" className="text-sm text-destructive">
              {invite.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={invite.pending}>
              {t('sendInvitation')}
            </Button>
          </DialogFooter>
        </form>
      </ScrollDialogContent>
    </Dialog>
  );
}

function EditDialog({
  member,
  points,
  roleOptions,
  onClose,
}: {
  member: MemberView;
  points: { code: string; label: string }[];
  roleOptions: { value: string; label: string }[];
  onClose: () => void;
}) {
  const t = useTranslations('users');
  const uid = useId();
  const [role, setRole] = useState(member.role);
  const update = useServerAction(updateMemberAction, {
    errors: 'usersError',
    success: t('saved'),
    onDone: onClose,
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <ScrollDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editName', { name: member.name })}</DialogTitle>
          <DialogDescription>{member.email}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            form.set('userId', member.userId);
            form.set('role', role);
            form.set('currentRole', member.role);
            update.run(form);
          }}
        >
          <FormField label={t('role')} required>
            {(props) => (
              <ChoiceSelect value={role} onChange={setRole} options={roleOptions} a11y={props} />
            )}
          </FormField>
          {!UNRESTRICTED.has(role) && (
            <div className="space-y-1.5">
              <span id={`${uid}-points`} className="text-sm leading-none font-medium">
                {t('issuePoints')}
              </span>
              <p className="text-xs text-muted-foreground">{t('issuePointsHint')}</p>
              <div
                role="group"
                aria-labelledby={`${uid}-points`}
                className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-input p-1.5"
              >
                {points.map((point) => (
                  <label
                    key={point.code}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      name="points"
                      value={point.code}
                      defaultChecked={member.issuePoints.includes(point.code)}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    {point.label}
                  </label>
                ))}
              </div>
            </div>
          )}
          {update.error && (
            <p role="alert" className="text-sm text-destructive">
              {update.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={update.pending}>
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </ScrollDialogContent>
    </Dialog>
  );
}

// FR-USR-3: saved on toggle, so the switch always shows what is in force.
function TwoFactorRequirement({ required }: { required: boolean }) {
  const t = useTranslations('users');
  const uid = useId();
  const [checked, setChecked] = useState(required);
  const save = useServerAction(setTwoFactorRequirementAction, {
    errors: 'usersError',
    success: t('securitySaved'),
  });
  return (
    <section
      aria-labelledby={`${uid}-title`}
      className="rounded-xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id={`${uid}-title`} className="text-sm font-medium">
            {t('requireTwoFactor')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('requireTwoFactorHint')}</p>
        </div>
        <Switch
          checked={checked}
          disabled={save.pending}
          aria-labelledby={`${uid}-title`}
          onCheckedChange={(next) => {
            setChecked(next);
            save.run(next ? { required: 'on' } : {});
          }}
        />
      </div>
      {save.error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {save.error}
        </p>
      )}
    </section>
  );
}
