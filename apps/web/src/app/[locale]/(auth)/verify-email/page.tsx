import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthCard, AuthShell, Notice } from '@/components/auth-shell';
import { BackLink } from '../back-link';
import { ResendVerificationForm, VerifyEmailForm } from '../forms';
import { pageTitle } from '@/server/page-title';

export const generateMetadata = pageTitle('verifyEmail');

// GET only shows the button: link scanners prefetch, so only the POST consumes (FR-ONB-1).
export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ locale }, { token }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations('verifyEmail');
  const tAuth = await getTranslations('auth');

  return (
    <AuthShell
      title={t('confirmTitle')}
      description={token ? t('confirmDescription') : undefined}
      topLeft={<BackLink href="/login">{tAuth('backToLogin')}</BackLink>}
    >
      <AuthCard>
        {token ? (
          <VerifyEmailForm token={token} />
        ) : (
          <>
            <Notice tone="error">{t('missingToken')}</Notice>
            <ResendVerificationForm />
          </>
        )}
      </AuthCard>
    </AuthShell>
  );
}
