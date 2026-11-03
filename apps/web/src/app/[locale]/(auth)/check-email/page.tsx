import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthCard, AuthShell } from '@/components/auth-shell';
import { BackLink } from '../back-link';
import { ResendVerificationForm } from '../forms';
import { pageTitle } from '@/server/page-title';

export const generateMetadata = pageTitle('checkEmail');

export default async function CheckEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('checkEmail');
  const tAuth = await getTranslations('auth');

  return (
    <AuthShell
      title={t('title')}
      description={t('description')}
      topLeft={<BackLink href="/login">{tAuth('backToLogin')}</BackLink>}
    >
      <AuthCard>
        <p className="mb-4 text-sm text-muted-foreground">{t('notReceived')}</p>
        <ResendVerificationForm />
      </AuthCard>
    </AuthShell>
  );
}
