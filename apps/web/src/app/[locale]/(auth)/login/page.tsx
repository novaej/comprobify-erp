import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthCard, AuthShell, Notice } from '@/components/auth-shell';
import { safeNextPath } from '@/server/paths';
import { BackLink, FooterLink } from '../back-link';
import { SignInForm } from '../forms';

const NOTICES = { idle: 'idleTimeout', reset: 'passwordReset' } as const;

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reason?: string; next?: string }>;
}) {
  const [{ locale }, { reason, next }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations('auth');
  const notice = reason && reason in NOTICES ? NOTICES[reason as keyof typeof NOTICES] : null;

  return (
    <AuthShell
      title={t('login.subtitle')}
      topLeft={<BackLink href="/">{t('backToHome')}</BackLink>}
    >
      {notice && (
        <Notice tone={notice === 'passwordReset' ? 'success' : 'muted'}>
          {t(`login.${notice}`)}
        </Notice>
      )}
      <AuthCard>
        <SignInForm next={safeNextPath(next) ?? undefined} />
      </AuthCard>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        {t('login.noAccount')} <FooterLink href="/register">{t('login.register')}</FooterLink>
      </p>
    </AuthShell>
  );
}
