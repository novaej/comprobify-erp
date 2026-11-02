import { ShieldOff } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

// Shown when the role lacks the page's permission; core would refuse the actions anyway.
export async function NoAccess() {
  const t = await getTranslations('noAccess');
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
      <ShieldOff className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t('description')}</p>
    </div>
  );
}
