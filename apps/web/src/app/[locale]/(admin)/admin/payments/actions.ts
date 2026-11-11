'use server';

import {
  markPaymentInvoiced,
  refundPayment,
  resolveCardAttempt,
  reviewPayment,
  waivePaymentInvoice,
  type PaymentRejectionReason,
} from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';

// FR-ADM-2: the operator's payment work. Core checks the super admin flag on every call.

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');

async function run(
  form: FormData,
  change: (ctx: Awaited<ReturnType<typeof context>>) => Promise<void>,
): Promise<ActionState> {
  const ctx = await context(form);
  const state = await toActionState(() => change(ctx));
  if (state.done) revalidatePath(`/${localeOf(form)}/admin`, 'layout');
  return state;
}
async function context(form: FormData) {
  const { actor } = await loadPlatform(localeOf(form));
  const { db, notice } = await getRuntime();
  return { actor, db, notice };
}

export async function verifyPaymentAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db, notice }) =>
    reviewPayment(actor, db, { paymentId: text(form, 'paymentId'), decision: 'VERIFIED' }, notice),
  );
}

export async function rejectPaymentAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db, notice }) =>
    reviewPayment(
      actor,
      db,
      {
        paymentId: text(form, 'paymentId'),
        decision: 'REJECTED',
        reason: text(form, 'reason') as PaymentRejectionReason,
      },
      notice,
    ),
  );
}

export async function refundPaymentAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    refundPayment(actor, db, { paymentId: text(form, 'paymentId'), reason: text(form, 'reason') }),
  );
}

export async function markInvoicedAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    markPaymentInvoiced(actor, db, {
      paymentId: text(form, 'paymentId'),
      accessKey: text(form, 'accessKey').replace(/\s/g, ''),
    }),
  );
}

export async function resolveCardAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    resolveCardAttempt(actor, db, { attemptId: text(form, 'attemptId'), note: text(form, 'note') }),
  );
}

// FR-BILL-4: a verified payment that needs no invoice leaves the queue, with the operator's reason.
export async function waiveInvoiceAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    waivePaymentInvoice(actor, db, {
      paymentId: text(form, 'paymentId'),
      reason: text(form, 'reason'),
    }),
  );
}
