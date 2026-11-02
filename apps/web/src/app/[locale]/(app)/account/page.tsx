import { chooseActiveOrganization, listOrganizations } from '@comprobify/core';
import { Badge } from '@comprobify/ui/components/badge';
import { Button, buttonVariants } from '@comprobify/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@comprobify/ui/components/card';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getRuntime } from '@/server/runtime';
import { requireSession } from '@/server/session';
import { Notice } from '@/components/auth-shell';
import { signOutAction, signOutEverywhereAction } from '../actions';
import { TwoFactorSettings } from './two-factor';

// The user's own account: their organizations and sessions. Outside the shell, so it
// works before the first organization exists.
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ twoFactorRequired?: string }>;
}) {
  const [{ locale }, { twoFactorRequired }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const session = await requireSession(locale);
  const { db } = await getRuntime();
  const organizations = await listOrganizations(db, session.user.id);
  // The same rule as the shell, so both show the same active organization.
  const active = chooseActiveOrganization(organizations, session.activeTenantId);
  const t = await getTranslations('account');
  const tSecurity = await getTranslations('security');

  return (
    <main
      id="main-content"
      className="flex min-h-screen flex-col items-center justify-center gap-6 p-4 md:p-8"
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('title', { name: session.user.name })}</CardTitle>
          <CardDescription>{session.user.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {organizations.length === 0 ? (
            <Link href="/onboarding" className={buttonVariants()}>
              {t('setUpCompany')}
            </Link>
          ) : (
            <ul className="space-y-2" aria-label={t('organizations')}>
              {organizations.map((organization) => (
                <li
                  key={organization.realTenantId}
                  className="rounded-lg border border-border p-3 text-sm"
                >
                  <div className="font-medium">{organization.name}</div>
                  <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                    <span className="font-mono">{organization.ruc}</span>
                    {active?.tenantId === organization.twinTenantId && (
                      <Badge variant="secondary">{t('activeTest')}</Badge>
                    )}
                    {active?.tenantId === organization.realTenantId && (
                      <Badge variant="secondary">{t('activeProduction')}</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form action={signOutAction}>
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" variant="outline" className="w-full">
              {t('signOut')}
            </Button>
          </form>
          <form action={signOutEverywhereAction}>
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" variant="ghost" className="w-full">
              {t('signOutEverywhere')}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{tSecurity('title')}</CardTitle>
          <CardDescription>{tSecurity('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {twoFactorRequired && !session.user.twoFactorEnabled && (
            <Notice tone="error">{tSecurity('requiredByOrganization')}</Notice>
          )}
          <TwoFactorSettings enabled={session.user.twoFactorEnabled} />
        </CardContent>
      </Card>
    </main>
  );
}
