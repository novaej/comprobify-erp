import { Card, CardContent } from '@comprobify/ui/components/card';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NoAccess } from '@/components/no-access';
import { loadShell } from '@/server/shell';
import { GoLiveForm } from './form';

// FR-ONB-5: one-way, so the page says exactly what changes before asking.
export default async function GoLivePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor, active } = await loadShell(locale);
  if (!actor.permissions.includes('organization.go_live')) return <NoAccess />;
  const t = await getTranslations('goLive');

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('title', { organization: active.entry.name })}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <Card>
        <CardContent className="space-y-4">
          {active.entry.live ? (
            <p className="text-sm">{t('alreadyLive')}</p>
          ) : (
            <>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <li>{t('point1')}</li>
                <li>{t('point2')}</li>
                <li>{t('point3')}</li>
                <li>{t('point4')}</li>
              </ul>
              <GoLiveForm />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
