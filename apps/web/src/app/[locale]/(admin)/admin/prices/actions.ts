'use server';

import {
  discardPrice,
  draftPrice,
  publishPrice,
  scheduleIvaRate,
  withdrawIvaRate,
  type DraftPriceInput,
} from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');

async function run(form: FormData, change: Parameters<typeof toActionState>[0]) {
  const state = await toActionState(change);
  if (state.done) revalidatePath(`/${localeOf(form)}/admin`, 'layout');
  return state;
}

// FR-BILL-6. Core checks the flag, what can be priced and the notice a rise owes.
export async function draftPriceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadPlatform(localeOf(form));
  const { db } = await getRuntime();
  // Typed with a decimal comma or point; core takes the point.
  const amount = form.get('withdraw') === 'on' ? null : text(form, 'amount').replace(',', '.');
  const kind = text(form, 'kind');
  const input = (
    kind === 'PLAN'
      ? { kind, planKey: text(form, 'key'), amount }
      : kind === 'MODULE'
        ? { kind, moduleKey: text(form, 'key'), amount }
        : kind === 'PACK'
          ? { kind, packSize: Number(text(form, 'packSize')), amount }
          : { kind, amount }
  ) as DraftPriceInput;
  return run(form, async () => {
    await draftPrice(actor, db, input);
  });
}

export async function publishPriceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadPlatform(localeOf(form));
  const { db } = await getRuntime();
  return run(form, async () => {
    await publishPrice(actor, db, {
      id: text(form, 'id'),
      effectiveOn: text(form, 'effectiveOn') || null,
    });
  });
}

export async function discardPriceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadPlatform(localeOf(form));
  const { db } = await getRuntime();
  return run(form, async () => {
    await discardPrice(actor, db, text(form, 'id'));
  });
}

// FR-BILL-2 (ADR-034): the IVA on subscriptions from a date on, and withdrawing one to come.
export async function scheduleIvaAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadPlatform(localeOf(form));
  const { db } = await getRuntime();
  return run(form, () =>
    scheduleIvaRate(actor, db, {
      rate: text(form, 'rate').replace(',', '.'),
      effectiveOn: text(form, 'effectiveOn'),
    }),
  );
}

export async function withdrawIvaAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadPlatform(localeOf(form));
  const { db } = await getRuntime();
  return run(form, () => withdrawIvaRate(actor, db, text(form, 'id')));
}
