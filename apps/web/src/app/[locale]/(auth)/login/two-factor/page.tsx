import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthCard, AuthShell } from '@/components/auth-shell';
import { safeNextPath } from '@/server/paths';
import { BackLink } from '../../back-link';
import { TwoFactorForm } from '../../forms';

// The second step of a sign-in (FR-USR-3). Better Auth's short-lived cookie from the
// first step identifies the user; no session exists until a code is accepted.
export default async function TwoFactorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ locale }, { next }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations('twoFactor');
  const tAuth = await getTranslations('auth');

  return (
    <AuthShell
      title={t('title')}
      description={t('description')}
      topLeft={<BackLink href="/login">{tAuth('backToLogin')}</BackLink>}
    >
      <AuthCard>
        <TwoFactorForm next={safeNextPath(next) ?? undefined} />
      </AuthCard>
    </AuthShell>
  );
}
