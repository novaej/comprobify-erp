'use server';

import {
  cancelSaleOrder,
  confirmSaleOrder,
  correctOrderInvoice,
  createSaleOrder,
  invoiceSaleOrder,
  updateSaleOrder,
  type OrderInvoiceCorrectionInput,
  type OrderInvoiceInput,
  type SaleOrderInput,
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

// FR-SAL-1. Core checks the module, the role, the client and every product.
export async function saveSaleOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = localeOf(form);
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  let payload: SaleOrderInput;
  try {
    payload = JSON.parse(text(form, 'payload')) as SaleOrderInput;
  } catch {
    return { error: 'INVALID_INPUT' };
  }
  const existing = text(form, 'id');
  let id: string | undefined;
  const state = await toActionState(async () => {
    id = existing
      ? (await updateSaleOrder(actor, db, existing, payload)).id
      : (await createSaleOrder(actor, db, payload)).id;
  });
  if (!id) return state;
  // Holding goods changes the stock pages too.
  revalidatePath(`/${locale}`, 'layout');
  return redirect({ href: `/sale-orders/${id}`, locale });
}

// Each status change is asked first in the page; core holds the rules (FR-DOC-3).
export async function saleOrderStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = localeOf(form);
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  const id = text(form, 'id');
  const change = text(form, 'change');
  if (!['confirm', 'cancel'].includes(change)) return { error: 'INVALID_INPUT' };
  const state = await toActionState(async () => {
    if (change === 'confirm') await confirmSaleOrder(actor, db, id);
    else await cancelSaleOrder(actor, db, { id, reason: text(form, 'reason') });
  });
  if (state.done) revalidatePath(`/${locale}`, 'layout');
  return state;
}

// FR-SAL-3, FR-SAL-6. Core holds each line to what the order has left and takes the order's
// goods over for the invoice in the same transaction.
export async function invoiceOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = localeOf(form);
  const { actor } = await loadShell(locale);
  const { db, issueDeps } = await getRuntime();
  let payload: OrderInvoiceInput;
  try {
    payload = JSON.parse(text(form, 'payload')) as OrderInvoiceInput;
  } catch {
    return { error: 'INVALID_INPUT' };
  }
  let id: string | undefined;
  const state = await toActionState(async () => {
    id = (await invoiceSaleOrder(actor, db, payload, issueDeps)).id;
  });
  if (!id) return state;
  revalidatePath(`/${locale}`, 'layout');
  return redirect({ href: `/documents/${id}`, locale });
}

// FR-DOC-7: an order's invoice is corrected through its order, the same row and number.
export async function correctOrderInvoiceAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeOf(form);
  const { actor } = await loadShell(locale);
  const { db, issueDeps } = await getRuntime();
  const id = text(form, 'id');
  let payload: OrderInvoiceCorrectionInput;
  try {
    payload = JSON.parse(text(form, 'payload')) as OrderInvoiceCorrectionInput;
  } catch {
    return { error: 'INVALID_INPUT' };
  }
  let done = false;
  const state = await toActionState(async () => {
    await correctOrderInvoice(actor, db, id, payload, issueDeps);
    done = true;
  });
  if (!done) return state;
  revalidatePath(`/${locale}`, 'layout');
  return redirect({ href: `/documents/${id}`, locale });
}
