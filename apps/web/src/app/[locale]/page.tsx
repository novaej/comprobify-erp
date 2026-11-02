import { Badge } from '@comprobify/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@comprobify/ui/components/card';
import { ThemeToggle } from '@comprobify/ui/theme';
import { getTranslations, setRequestLocale } from 'next-intl/server';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const tTheme = await getTranslations('theme');

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
        <CardContent>
          <Badge variant="secondary">{t('status')}</Badge>
        </CardContent>
      </Card>
    </div>
  );
}
