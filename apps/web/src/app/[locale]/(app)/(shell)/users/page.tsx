import { listIssuePoints, listMembers } from '@comprobify/core';
import { Badge } from '@comprobify/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@comprobify/ui/components/card';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NoAccess } from '@/components/no-access';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { AccessForm, InviteForm, RemoveForm, RevokeForm, RoleForm } from './forms';

// FR-USR-1, FR-ROLE-2. Core enforces every permission; the page only hides what it would refuse.
export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!actor.permissions.includes('users.read')) return <NoAccess />;

  const { db } = await getRuntime();
  const [{ members, invitations }, points] = await Promise.all([
    listMembers(actor, db),
    listIssuePoints(actor, db),
  ]);
  const t = await getTranslations('users');
  const tRoles = await getTranslations('roles');
  const manage = actor.permissions.includes('users.manage');
  const pointOptions = points.map((point) => ({
    code: `${point.branchCode}-${point.pointCode}`,
    label: `${point.branchCode}-${point.pointCode} ${point.branchName}`,
  }));
  const dateFormat = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {manage && (
        <Card>
          <CardHeader>
            <CardTitle>{t('inviteTitle')}</CardTitle>
            <CardDescription>{t('inviteDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('membersTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border" aria-label={t('membersTitle')}>
            {members.map((member) => {
              const editable = manage && member.role !== 'OWNER' && member.userId !== actor.userId;
              return (
                <li
                  key={member.userId}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{member.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{member.email}</p>
                    <div className="mt-1 flex gap-2">
                      <Badge variant="secondary">{tRoles(member.role)}</Badge>
                      {member.issuePoints.length > 0 && (
                        <Badge variant="outline">
                          {t('restricted', { points: member.issuePoints.join(', ') })}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {editable && (
                    <div className="flex flex-col gap-2 sm:items-end">
                      <div className="flex items-center gap-1">
                        <RoleForm userId={member.userId} role={member.role} name={member.name} />
                        <RemoveForm userId={member.userId} name={member.name} />
                      </div>
                      <AccessForm
                        userId={member.userId}
                        name={member.name}
                        points={pointOptions}
                        selected={member.issuePoints}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {manage && invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('pendingTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border" aria-label={t('pendingTitle')}>
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate">{invitation.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {tRoles(invitation.role)} ·{' '}
                      {t('expires', { date: dateFormat.format(invitation.expiresAt) })}
                    </p>
                  </div>
                  <RevokeForm invitationId={invitation.id} email={invitation.email} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
