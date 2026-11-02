import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthCard, AuthShell } from '@/components/auth-shell';
import { BackLink } from '../back-link';
import { ForgotPasswordForm } from '../forms';

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('forgotPassword');
  const tAuth = await getTranslations('auth');

  return (
    <AuthShell
      title={t('subtitle')}
      description={t('description')}
      topLeft={<BackLink href="/login">{tAuth('backToLogin')}</BackLink>}
    >
      <AuthCard>
        <ForgotPasswordForm />
      </AuthCard>
    </AuthShell>
  );
}
