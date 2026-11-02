import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthCard, AuthShell } from '@/components/auth-shell';
import { BackLink, FooterLink } from '../back-link';
import { SignUpForm } from '../forms';

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth');

  return (
    <AuthShell
      title={t('register.subtitle')}
      topLeft={<BackLink href="/">{t('backToHome')}</BackLink>}
    >
      <AuthCard>
        <SignUpForm />
      </AuthCard>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        {t('register.hasAccount')} <FooterLink href="/login">{t('register.login')}</FooterLink>
      </p>
    </AuthShell>
  );
}
