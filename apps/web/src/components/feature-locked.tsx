import type { ActorContext } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { Lock } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

// Shown instead of a page whose feature the plan lacks (FR-PLAN-4); core refuses
// its actions anyway. Who can see the plan is sent there; others ask the owner.
export async function FeatureLocked({ actor }: { actor: ActorContext }) {
  const t = await getTranslations('featureLocked');
  const canSeePlan = actor.permissions.includes('billing.read');
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
      <Lock className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {canSeePlan ? t('descriptionPlan') : t('descriptionAsk')}
      </p>
      {canSeePlan && (
        <Link href="/plan" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('seePlan')}
        </Link>
      )}
    </div>
  );
}
