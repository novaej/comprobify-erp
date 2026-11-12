import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthCard, AuthShell, Notice } from '@/components/auth-shell';
import { BackLink, FooterLink } from '../back-link';
import { ResetPasswordForm } from '../forms';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';

export const generateMetadata = pageTitle('resetPassword');

// GET shows the form; the token is consumed only by its POST (Appendix B, lesson 5).
export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ locale }, { token }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations('resetPassword');
  const tAuth = await getTranslations('auth');
  // A link already used, or past its hour, says so here rather than after typing a password.
  const usable = token ? await (await getRuntime()).identity.resetLinkValid(token) : false;

  return (
    <AuthShell
      title={t('title')}
      description={t('subtitle')}
      topLeft={<BackLink href="/login">{tAuth('backToLogin')}</BackLink>}
    >
      {usable && token ? (
        <AuthCard>
          <ResetPasswordForm token={token} />
        </AuthCard>
      ) : (
        <>
          <Notice tone="error">{t('invalidLinkMessage')}</Notice>
          <FooterLink href="/forgot-password">{t('requestNewLink')}</FooterLink>
        </>
      )}
    </AuthShell>
  );
}
