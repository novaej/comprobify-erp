'use server';

import {
  buyAddOn,
  buyPack,
  cancelPayment,
  cancelScheduledChange,
  cancelSubscription,
  dropAddOn,
  isDomainError,
  previewPlanChange,
  removeProof,
  requestPlanChange,
  requestSeats,
  resumeSubscription,
  startCardPayment,
  startPaidPlan,
  submitProof,
  type CardSession,
} from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

// FR-BILL-1, FR-BILL-3, FR-BILL-5, FR-BILL-7: thin adapters; core checks the role and every rule.

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');
const intervalOf = (form: FormData) => (text(form, 'interval') === 'YEARLY' ? 'YEARLY' : 'MONTHLY');

// What changes the plan also changes the shell: the nav, the banners and the limits.
async function run(form: FormData, change: () => Promise<unknown>): Promise<ActionState> {
  const state = await toActionState(async () => {
    await change();
  });
  if (state.done) revalidatePath(`/${localeOf(form)}`, 'layout');
  return state;
}

async function context(form: FormData) {
  const { actor } = await loadShell(localeOf(form));
  const runtime = await getRuntime();
  return { actor, ...runtime };
}

export async function startPlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, db, billingDeps } = await context(form);
  return run(form, () =>
    startPaidPlan(
      actor,
      db,
      { planKey: text(form, 'planKey'), interval: intervalOf(form) },
      billingDeps,
    ),
  );
}

export type PreviewState =
  | { error: string }
  | { when: 'NOW'; base: string; iva: string; total: string }
  | { when: 'PERIOD_END'; effectiveOn: string };

// What a change of plan or interval would cost, before the person confirms it.
export async function previewPlanAction(
  locale: string,
  planKey: string,
  interval: string,
): Promise<PreviewState> {
  const { actor } = await loadShell(locale);
  const { db, billingDeps } = await getRuntime();
  try {
    const quote = await previewPlanChange(
      actor,
      db,
      { planKey, interval: interval === 'YEARLY' ? 'YEARLY' : 'MONTHLY' },
      billingDeps,
    );
    return quote.when === 'NOW'
      ? {
          when: 'NOW',
          base: quote.amounts.baseAmount,
          iva: quote.amounts.ivaAmount,
          total: quote.amounts.totalAmount,
        }
      : quote;
  } catch (error) {
    if (isDomainError(error)) return { error: error.code };
    throw error;
  }
}

export async function changePlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, db, billingDeps } = await context(form);
  return run(form, () =>
    requestPlanChange(
      actor,
      db,
      { planKey: text(form, 'planKey'), interval: intervalOf(form) },
      billingDeps,
    ),
  );
}

export async function cancelScheduledAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, db, billingDeps } = await context(form);
  return run(form, () => cancelScheduledChange(actor, db, billingDeps));
}

export async function seatsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, db, billingDeps } = await context(form);
  return run(form, () =>
    requestSeats(actor, db, { extraSeats: Number(text(form, 'extraSeats')) }, billingDeps),
  );
}

export async function buyAddOnAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, db, billingDeps } = await context(form);
  return run(form, () => buyAddOn(actor, db, { moduleKey: text(form, 'moduleKey') }, billingDeps));
}

export async function dropAddOnAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, db, billingDeps } = await context(form);
  return run(form, () => dropAddOn(actor, db, { moduleKey: text(form, 'moduleKey') }, billingDeps));
}

export async function cancelSubscriptionAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { actor, db, billingDeps } = await context(form);
  return run(form, () => cancelSubscription(actor, db, billingDeps));
}

export async function resumeSubscriptionAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { actor, db } = await context(form);
  return run(form, () => resumeSubscription(actor, db));
}

export async function buyPackAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, db, billingDeps } = await context(form);
  return run(form, () =>
    buyPack(actor, db, { packSize: Number(text(form, 'packSize')) }, billingDeps),
  );
}

export async function cancelPaymentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, db } = await context(form);
  return run(form, () => cancelPayment(actor, db, text(form, 'paymentId')));
}

export async function submitProofAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, db } = await context(form);
  const files = await Promise.all(
    form
      .getAll('files')
      .filter((value): value is File => value instanceof File && value.size > 0)
      .map(async (file) => ({
        filename: file.name,
        content: Buffer.from(await file.arrayBuffer()),
      })),
  );
  if (files.length === 0) return { error: 'PROOF_REQUIRED' };
  return run(form, () =>
    submitProof(actor, db, {
      paymentId: text(form, 'paymentId'),
      reference: text(form, 'reference'),
      files,
    }),
  );
}

export async function removeProofAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, db } = await context(form);
  return run(form, () =>
    removeProof(actor, db, { paymentId: text(form, 'paymentId'), proofId: text(form, 'proofId') }),
  );
}

export type CardSessionState = { error: string } | { session: CardSession };

// A new attempt for Payphone's widget, minted when the person picks the card.
export async function startCardAction(
  locale: string,
  paymentId: string,
): Promise<CardSessionState> {
  const { actor } = await loadShell(locale);
  const { db, payphoneDeps } = await getRuntime();
  try {
    return { session: await startCardPayment(actor, db, { paymentId }, payphoneDeps) };
  } catch (error) {
    if (isDomainError(error)) return { error: error.code };
    throw error;
  }
}
