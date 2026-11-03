import { getInvitation, systemClock } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthCard, AuthShell, Notice } from '@/components/auth-shell';
import { Link } from '@/i18n/navigation';
import { getRuntime } from '@/server/runtime';
import { getSession } from '@/server/session';
import { signOutAction } from '../(app)/actions';
import { AcceptForm, NewUserForm } from './forms';
import { pageTitle } from '@/server/page-title';

export const generateMetadata = pageTitle('invite');

// GET only shows the invitation; accepting is a POST (Appendix B, lesson 5).
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ locale }, { token }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations('invite');
  const tRoles = await getTranslations('roles');
  const { db } = await getRuntime();
  const invitation = token ? await getInvitation(db, token, systemClock) : null;
  const session = await getSession();

  if (!token || invitation?.state !== 'pending') {
    return (
      <AuthShell title={t('invalidTitle')}>
        <Notice tone="error">{t('invalidBody')}</Notice>
      </AuthShell>
    );
  }

  const description = t('description', {
    organization: invitation.organization,
    role: tRoles(invitation.role),
  });
  const signedInAs = session.status === 'active' ? session.user.email : null;

  return (
    <AuthShell
      title={t('title', { organization: invitation.organization })}
      description={description}
    >
      <AuthCard>
        {signedInAs === invitation.email ? (
          <AcceptForm token={token} />
        ) : signedInAs ? (
          <>
            <Notice tone="error">
              {t('otherAccount', { email: invitation.email, current: signedInAs })}
            </Notice>
            <form action={signOutAction}>
              <input type="hidden" name="locale" value={locale} />
              <button
                type="submit"
                className={buttonVariants({ variant: 'outline', className: 'w-full' })}
              >
                {t('signOut')}
              </button>
            </form>
          </>
        ) : invitation.hasAccount ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              {t('signInToAccept', { email: invitation.email })}
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`}
              className={buttonVariants({ className: 'h-11 w-full text-base' })}
            >
              {t('signIn')}
            </Link>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              {t('newAccount', { email: invitation.email })}
            </p>
            <NewUserForm token={token} />
          </>
        )}
      </AuthCard>
    </AuthShell>
  );
}
