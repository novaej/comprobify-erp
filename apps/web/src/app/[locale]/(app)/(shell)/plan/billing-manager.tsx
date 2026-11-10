'use client';

import type { BillingOverview } from '@comprobify/core';
import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { ChoiceSelect } from '@/components/choice-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import { ToneBadge } from '@/components/tone-badge';
import { useServerAction } from '@/components/use-server-action';
import {
  buyAddOnAction,
  buyPackAction,
  cancelScheduledAction,
  cancelSubscriptionAction,
  changePlanAction,
  dropAddOnAction,
  previewPlanAction,
  resumeSubscriptionAction,
  seatsAction,
  startPlanAction,
  type PreviewState,
} from './actions';

type Interval = 'MONTHLY' | 'YEARLY';
type Named = { nameEs: string; nameEn: string };

// What the company may ask for. Core decides; a disabled control only says why first.
export type BillingFlags = {
  canManage: boolean;
  // A payment of the company's own making is open: one at a time.
  changeOpen: boolean;
  // The quota is unlimited: nothing to top up.
  unlimited: boolean;
};

function useName() {
  const english = useLocale() === 'en';
  return (row: Named) => (english ? row.nameEn : row.nameEs);
}

const day = (iso: string) => iso.split('-').reverse().join('/');

// FR-BILL-1, FR-BILL-5: the plan, and choosing or changing it.
export function PlanSection({
  overview,
  flags,
}: {
  overview: BillingOverview;
  flags: BillingFlags;
}) {
  const t = useTranslations('plan.manage');
  const tIntervals = useTranslations('plan.intervals');
  const tError = useTranslations('planError');
  const locale = useLocale();
  const name = useName();
  const { subscription, plans } = overview;
  const billed = subscription.periodEnd !== null;
  const paid = subscription.billing === 'PAID';
  const [choosing, setChoosing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [planKey, setPlanKey] = useState(
    plans.find((plan) => plan.key !== subscription.planKey)?.key ?? plans[0]?.key ?? '',
  );
  const [interval, setCycle] = useState<Interval>(subscription.interval);
  const [quote, setQuote] = useState<PreviewState | null>(null);
  const [quoting, startQuoting] = useTransition();

  // A change shows what it costs now, or when it applies, before it is asked for.
  const choose = (nextPlan: string, nextInterval: Interval) => {
    setPlanKey(nextPlan);
    setCycle(nextInterval);
    if (!billed || !nextPlan) return;
    setQuote(null);
    startQuoting(async () => setQuote(await previewPlanAction(locale, nextPlan, nextInterval)));
  };

  const cancel = useServerAction(cancelSubscriptionAction, {
    errors: 'planError',
    success: t('cancelled'),
    onDone: () => setCancelling(false),
  });
  const resume = useServerAction(resumeSubscriptionAction, {
    errors: 'planError',
    success: t('resumed'),
  });
  const undo = useServerAction(cancelScheduledAction, {
    errors: 'planError',
    success: t('undone'),
    onDone: () => setUndoing(false),
  });

  const chosen = plans.find((plan) => plan.key === planKey);
  const active = paid && billed && subscription.status === 'ACTIVE';
  const pending = subscription.pending;
  const pendingWhen = {
    interval: tIntervals(pending.interval ?? subscription.interval),
    date: day(subscription.periodEnd ?? ''),
  };
  const pendingText = pending.plan
    ? t('pendingPlan', { ...pendingWhen, plan: name(pending.plan) })
    : pending.interval
      ? t('pendingInterval', pendingWhen)
      : null;
  const quoteText = (() => {
    if (!billed)
      return chosen
        ? t('fullPrice', { amount: interval === 'YEARLY' ? chosen.yearly : chosen.monthly })
        : '';
    if (quoting || !quote) return t('quoting');
    if ('error' in quote) return tError.has(quote.error) ? tError(quote.error) : tError('UNKNOWN');
    return quote.when === 'NOW'
      ? t('quoteNow', { total: quote.total, base: quote.base, iva: quote.iva })
      : t('quoteLater', { date: day(quote.effectiveOn) });
  })();

  return (
    <>
      {pendingText && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ToneBadge tone="info">{pendingText}</ToneBadge>
          {flags.canManage && active && (
            <Button size="sm" variant="ghost" onClick={() => setUndoing(true)}>
              {t('undo')}
            </Button>
          )}
        </div>
      )}
      {subscription.status === 'CANCELLED' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ToneBadge tone="warning">
            {t('endsOn', { date: day(subscription.periodEnd ?? '') })}
          </ToneBadge>
          {flags.canManage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => resume.run({})}
              disabled={resume.pending}
            >
              {t('resume')}
            </Button>
          )}
          {resume.error && (
            <p role="alert" className="w-full text-sm text-destructive">
              {resume.error}
            </p>
          )}
        </div>
      )}
      {flags.canManage && paid && plans.length > 0 && (!billed || active) && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              setChoosing(true);
              choose(planKey, interval);
            }}
            disabled={flags.changeOpen}
          >
            {billed ? t('change') : t('choose')}
          </Button>
          {active && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCancelling(true)}
              disabled={flags.changeOpen}
            >
              {t('cancel')}
            </Button>
          )}
        </div>
      )}
      {flags.canManage && flags.changeOpen && (
        <p className="mt-2 text-xs text-muted-foreground">{t('finishPayment')}</p>
      )}

      <FormDialog
        open={choosing}
        onOpenChange={setChoosing}
        title={billed ? t('changeTitle') : t('chooseTitle')}
        description={billed ? t('changeDescription') : t('chooseDescription')}
        submitLabel={billed ? t('changeSubmit') : t('chooseSubmit')}
        action={billed ? changePlanAction : startPlanAction}
        errors="planError"
        success={billed ? t('changed') : t('chosen')}
        extra={{ planKey, interval }}
      >
        <FormField label={t('planField')}>
          {(a11y) => (
            <ChoiceSelect
              a11y={a11y}
              value={planKey}
              onChange={(value) => choose(value, interval)}
              options={plans.map((plan) => ({
                value: plan.key,
                label: t('planOption', { plan: name(plan), monthly: plan.monthly }),
              }))}
            />
          )}
        </FormField>
        <FormField label={t('intervalField')} hint={t('yearlyHint')}>
          {(a11y) => (
            <ChoiceSelect
              a11y={a11y}
              value={interval}
              onChange={(value) => choose(planKey, value as Interval)}
              options={(['MONTHLY', 'YEARLY'] as const).map((value) => ({
                value,
                label: tIntervals(value),
              }))}
            />
          )}
        </FormField>
        <p className="rounded-md bg-muted/40 px-3 py-2 text-sm" aria-live="polite">
          {quoteText}
        </p>
      </FormDialog>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t('cancelTitle')}
        description={t('cancelDescription', { date: day(subscription.periodEnd ?? '') })}
        confirmLabel={t('cancel')}
        destructive
        pending={cancel.pending}
        error={cancel.error}
        onConfirm={() => cancel.run({})}
      />
      <ConfirmDialog
        open={undoing}
        onOpenChange={setUndoing}
        title={t('undoTitle')}
        description={t('undoDescription')}
        detail={pendingText}
        confirmLabel={t('undo')}
        pending={undo.pending}
        error={undo.error}
        onConfirm={() => undo.run({})}
      />
    </>
  );
}

// FR-PLAN-1a: users beyond the plan's, prorated when added, removed at the period end.
export function SeatsSection({
  overview,
  flags,
  planUsers,
}: {
  overview: BillingOverview;
  flags: BillingFlags;
  // The plan's own number of users, before extra ones; null is unlimited.
  planUsers: number | null;
}) {
  const t = useTranslations('plan.seats');
  const { subscription, seatMonthly } = overview;
  const [open, setOpen] = useState(false);
  const [seats, setSeats] = useState(String(subscription.extraSeats));
  const active =
    subscription.billing === 'PAID' &&
    subscription.periodEnd !== null &&
    subscription.status === 'ACTIVE';
  if (planUsers === null || seatMonthly === null) return null;
  return (
    <SectionCard
      title={t('title')}
      description={t('description', { price: seatMonthly })}
      action={
        flags.canManage && active ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
            disabled={flags.changeOpen}
          >
            {t('change')}
          </Button>
        ) : undefined
      }
    >
      <p className="text-sm">
        {t('summary', { plan: planUsers, extra: subscription.extraSeats })}
        {subscription.pending.seats !== null && (
          <span className="ml-2">
            <ToneBadge tone="info">
              {t('pending', {
                seats: subscription.pending.seats,
                date: day(subscription.periodEnd ?? ''),
              })}
            </ToneBadge>
          </span>
        )}
      </p>
      {!active && subscription.billing === 'PAID' && (
        <p className="mt-1 text-xs text-muted-foreground">{t('needsPlan')}</p>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('changeTitle')}
        description={t('changeDescription', { price: seatMonthly })}
        submitLabel={t('submit')}
        action={seatsAction}
        errors="planError"
        success={t('done')}
        extra={{ extraSeats: seats }}
      >
        <FormField label={t('field')}>
          {(a11y) => (
            <Input
              {...a11y}
              type="number"
              min={0}
              max={1000}
              value={seats}
              onChange={(event) => setSeats(event.target.value)}
            />
          )}
        </FormField>
      </FormDialog>
    </SectionCard>
  );
}

// FR-PLAN-1a: modules on top of the plan, bought by the company itself.
export function AddOnsSection({
  overview,
  flags,
}: {
  overview: BillingOverview;
  flags: BillingFlags;
}) {
  const t = useTranslations('plan.addOns');
  const name = useName();
  const { subscription, addOns } = overview;
  const [acting, setActing] = useState<{ key: string; drop: boolean } | null>(null);
  const active =
    subscription.billing === 'PAID' &&
    subscription.periodEnd !== null &&
    subscription.status === 'ACTIVE';
  const target = addOns.find((addOn) => addOn.key === acting?.key);
  const buy = useServerAction(buyAddOnAction, {
    errors: 'planError',
    success: t('bought'),
    onDone: () => setActing(null),
  });
  const drop = useServerAction(dropAddOnAction, {
    errors: 'planError',
    success: t('dropped'),
    onDone: () => setActing(null),
  });
  const run = acting?.drop ? drop : buy;
  if (addOns.length === 0) return null;
  return (
    <SectionCard title={t('title')} description={active ? t('description') : t('needsPlan')}>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label={t('title')}>
        {addOns.map((addOn) => (
          <li
            key={addOn.key}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span className="font-medium">{name(addOn)}</span>
            <span className="text-xs text-muted-foreground">
              {t('price', { price: addOn.monthly })}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {addOn.state === 'ACTIVE' && <ToneBadge tone="success">{t('active')}</ToneBadge>}
              {addOn.state === 'LEAVING' && (
                <ToneBadge tone="warning">
                  {t('leaving', { date: day(subscription.periodEnd ?? '') })}
                </ToneBadge>
              )}
              {flags.canManage && active && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={flags.changeOpen && addOn.state !== 'ACTIVE'}
                  onClick={() => setActing({ key: addOn.key, drop: addOn.state === 'ACTIVE' })}
                >
                  {addOn.state === 'ACTIVE'
                    ? t('drop')
                    : addOn.state === 'LEAVING'
                      ? t('keep')
                      : t('buy')}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={acting !== null}
        onOpenChange={(open) => !open && setActing(null)}
        title={acting?.drop ? t('dropTitle') : t('buyTitle')}
        description={
          acting?.drop
            ? t('dropDescription', { date: day(subscription.periodEnd ?? '') })
            : t('buyDescription', { price: target?.monthly ?? '' })
        }
        detail={target ? name(target) : undefined}
        confirmLabel={acting?.drop ? t('drop') : t('buy')}
        destructive={acting?.drop}
        pending={run.pending}
        error={run.error}
        onConfirm={() => acting && run.run({ moduleKey: acting.key })}
      />
    </SectionCard>
  );
}

// FR-BILL-7: documents beyond the quota, used oldest first and kept until used.
export function PacksSection({
  overview,
  flags,
}: {
  overview: BillingOverview;
  flags: BillingFlags;
}) {
  const t = useTranslations('plan.packs');
  const { subscription, packs, packsLeft } = overview;
  const [buying, setBuying] = useState<number | null>(null);
  const buy = useServerAction(buyPackAction, {
    errors: 'planError',
    success: t('bought'),
    onDone: () => setBuying(null),
  });
  if (subscription.billing !== 'PAID' || flags.unlimited || packs.length === 0) return null;
  const chosen = packs.find((pack) => pack.size === buying);
  return (
    <SectionCard title={t('title')} description={t('description')}>
      <p className="text-sm">{t('left', { count: packsLeft })}</p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label={t('title')}>
        {packs.map((pack) => (
          <li
            key={pack.size}
            className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span>
              <span className="font-medium">{t('size', { size: pack.size })}</span>
              <span className="block text-xs text-muted-foreground">
                {t('price', { price: pack.price })}
              </span>
            </span>
            {flags.canManage && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBuying(pack.size)}
                disabled={flags.changeOpen || subscription.status === 'PAST_DUE'}
              >
                {t('buy')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={buying !== null}
        onOpenChange={(open) => !open && setBuying(null)}
        title={t('buyTitle')}
        description={t('buyDescription', { price: chosen?.price ?? '' })}
        detail={chosen ? t('size', { size: chosen.size }) : undefined}
        confirmLabel={t('buy')}
        pending={buy.pending}
        error={buy.error}
        onConfirm={() => buying !== null && buy.run({ packSize: String(buying) })}
      />
    </SectionCard>
  );
}
