import { Ban } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

// Core refuses writes while a company is past due or suspended (FR-BILL-5); a form page says so
// instead of failing. The shell banner above says why and where to pay.
export async function WriteBlocked() {
  const t = await getTranslations('noAccess');
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
      <Ban className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">{t('blockedTitle')}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t('blockedDescription')}</p>
    </div>
  );
}

export const writesBlocked = (actor: { standing: string }) =>
  actor.standing === 'SUSPENDED' || actor.standing === 'PAST_DUE';
