'use server';

import { recordPayment, voidPayment } from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');

// FR-SAL-10. Core checks the module, the role, the date and that it isn't more than is owed.
export async function recordPaymentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = localeOf(form);
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  const state = await toActionState(async () => {
    await recordPayment(actor, db, {
      documentId: text(form, 'documentId'),
      // Typed with a decimal comma or point; core takes the point (ADR-012).
      amount: text(form, 'amount').replace(',', '.'),
      paidOn: text(form, 'paidOn') || null,
      method: text(form, 'method') as '01',
      reference: text(form, 'reference') || null,
    });
  });
  if (state.done) revalidatePath(`/${locale}`, 'layout');
  return state;
}

export async function voidPaymentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = localeOf(form);
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  const state = await toActionState(async () => {
    await voidPayment(actor, db, { id: text(form, 'id'), reason: text(form, 'reason') });
  });
  if (state.done) revalidatePath(`/${locale}`, 'layout');
  return state;
}
