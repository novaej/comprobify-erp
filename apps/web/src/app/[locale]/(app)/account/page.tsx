import { Button } from '@comprobify/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@comprobify/ui/components/card';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireSession } from '@/server/session';
import { signOutAction, signOutEverywhereAction } from '../actions';

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { user } = await requireSession(locale);
  const t = await getTranslations('account');

  return (
    <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('title', { name: user.name })}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t('comingSoon')}</p>
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
    </div>
  );
}
