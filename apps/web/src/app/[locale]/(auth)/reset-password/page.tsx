import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthCard, AuthShell, Notice } from '@/components/auth-shell';
import { BackLink, FooterLink } from '../back-link';
import { ResetPasswordForm } from '../forms';

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

  return (
    <AuthShell
      title={t('title')}
      description={t('subtitle')}
      topLeft={<BackLink href="/login">{tAuth('backToLogin')}</BackLink>}
    >
      {token ? (
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
