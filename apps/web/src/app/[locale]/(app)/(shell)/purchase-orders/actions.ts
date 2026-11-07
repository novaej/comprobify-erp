'use server';

import {
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  markPurchaseOrderSent,
  receivePurchaseOrder,
  type ReceiptInput,
  updatePurchaseOrder,
  type PurchaseOrderInput,
} from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { redirect } from '@/i18n/navigation';
import { toActionState, type ActionState } from '@/server/actions';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');
const payloadOf = (form: FormData): unknown => {
  try {
    return JSON.parse(text(form, 'payload'));
  } catch {
    return undefined;
  }
};

// FR-PUR-1. Core checks the module, the role, the provider and every product.
export async function savePurchaseOrderAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeOf(form);
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  const payload = payloadOf(form) as PurchaseOrderInput | undefined;
  if (payload === undefined) return { error: 'INVALID_INPUT' };
  const existing = text(form, 'id');
  let id: string | undefined;
  const state = await toActionState(async () => {
    id = existing
      ? (await updatePurchaseOrder(actor, db, existing, payload)).id
      : (await createPurchaseOrder(actor, db, payload)).id;
  });
  if (!id) return state;
  revalidatePath(`/${locale}/purchase-orders`, 'layout');
  return redirect({ href: `/purchase-orders/${id}`, locale });
}

// Each status change is asked first in the page; core holds the rules (FR-DOC-3).
export async function orderStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = localeOf(form);
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  const id = text(form, 'id');
  const change = text(form, 'change');
  if (!['send', 'close', 'cancel'].includes(change)) return { error: 'INVALID_INPUT' };
  const state = await toActionState(async () => {
    if (change === 'send') await markPurchaseOrderSent(actor, db, id);
    else if (change === 'close') await closePurchaseOrder(actor, db, id);
    else await cancelPurchaseOrder(actor, db, { id, reason: text(form, 'reason') });
  });
  if (state.done) revalidatePath(`/${locale}/purchase-orders`, 'layout');
  return state;
}

// FR-PUR-2. Core checks what is left and moves the stock in the same transaction.
export async function receiveAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = localeOf(form);
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  const payload = payloadOf(form) as ReceiptInput | undefined;
  if (payload === undefined) return { error: 'INVALID_INPUT' };
  const state = await toActionState(async () => {
    await receivePurchaseOrder(actor, db, payload);
  });
  if (!state.done) return state;
  revalidatePath(`/${locale}`, 'layout');
  return redirect({ href: `/purchase-orders/${payload.orderId}`, locale });
}
