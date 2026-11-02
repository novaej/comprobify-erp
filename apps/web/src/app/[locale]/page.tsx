import { Badge } from '@comprobify/ui/components/badge';
import { buttonVariants } from '@comprobify/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@comprobify/ui/components/card';
import { ThemeToggle } from '@comprobify/ui/theme';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getSession } from '@/server/session';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const tTheme = await getTranslations('theme');
  const tLinks = await getTranslations('homeLinks');
  const signedIn = (await getSession()).status === 'active';

  return (
    <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>{t('title')}</CardTitle>
            <ThemeToggle labels={{ toLight: tTheme('toLight'), toDark: tTheme('toDark') }} />
          </div>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Badge variant="secondary">{t('status')}</Badge>
          <div className="flex gap-2">
            {signedIn ? (
              <Link href="/account" className={buttonVariants()}>
                {tLinks('account')}
              </Link>
            ) : (
              <>
                <Link href="/login" className={buttonVariants()}>
                  {tLinks('signIn')}
                </Link>
                <Link href="/register" className={buttonVariants({ variant: 'outline' })}>
                  {tLinks('register')}
                </Link>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
