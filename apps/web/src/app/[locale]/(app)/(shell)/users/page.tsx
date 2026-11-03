import { companyUsage, limitOf, listIssuePoints, listMembers } from '@comprobify/core';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { UserManager } from './user-manager';
import { pageTitle } from '@/server/page-title';

export const generateMetadata = pageTitle('users');

// FR-USR-1, FR-ROLE-2. Core enforces every permission; the page only hides what it would refuse.
export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor, active } = await loadShell(locale);
  if (!actor.permissions.includes('users.read')) return <NoAccess />;

  const { db } = await getRuntime();
  const [{ members, invitations }, points, usage] = await Promise.all([
    listMembers(actor, db),
    listIssuePoints(actor, db),
    companyUsage(actor, db),
  ]);
  const t = await getTranslations('users');
  const dateFormat = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });

  return (
    <div className="max-w-5xl">
      <PageHeader title={t('title')} description={t('description')} />
      <UserManager
        members={members}
        invitations={invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expires: dateFormat.format(invitation.expiresAt),
        }))}
        points={points.map((point) => ({
          code: `${point.branchCode}-${point.pointCode}`,
          label: `${point.branchCode}-${point.pointCode} ${point.branchName}`,
        }))}
        currentUserId={actor.userId!}
        canManage={actor.permissions.includes('users.manage')}
        canManageOrganization={actor.permissions.includes('organization.manage')}
        canSeePlan={actor.permissions.includes('billing.read')}
        seats={{ used: usage.USERS, limit: limitOf(actor.entitlements, 'USERS') }}
        requireTwoFactor={active.entry.requireTwoFactor}
      />
    </div>
  );
}
