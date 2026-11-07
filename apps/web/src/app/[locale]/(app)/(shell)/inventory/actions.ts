'use server';

import {
  adjustStock,
  importOpeningBalances,
  isDomainError,
  setOpeningBalance,
  type ImportProblem,
} from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};
// Typed with a decimal comma or point; core takes the point (ADR-012).
const decimal = (form: FormData, name: string) => text(form, name).replace(',', '.');
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');

// FR-INV-3. Core checks the module, the role and the negative-stock rule.
export async function adjustStockAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  const direction = text(form, 'direction') === 'OUT' ? 'OUT' : 'IN';
  const state = await toActionState(async () => {
    await adjustStock(actor, db, {
      productId: text(form, 'productId'),
      warehouseId: text(form, 'warehouseId'),
      direction,
      quantity: decimal(form, 'quantity'),
      unitCost: direction === 'IN' ? decimal(form, 'unitCost') || null : null,
      reason: text(form, 'reason'),
    });
  });
  if (state.done) revalidatePath(`/${localeOf(form)}/inventory`, 'layout');
  return state;
}

export async function openingBalanceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  const state = await toActionState(async () => {
    await setOpeningBalance(actor, db, {
      productId: text(form, 'productId'),
      warehouseId: text(form, 'warehouseId'),
      quantity: decimal(form, 'quantity'),
      unitCost: decimal(form, 'unitCost'),
    });
  });
  if (state.done) revalidatePath(`/${localeOf(form)}/inventory`, 'layout');
  return state;
}

export type ImportState = { error?: string; imported?: number; problems?: ImportProblem[] };

// The file is read in the browser and sent as text; core checks every line first.
export async function importOpeningAction(locale: string, content: string): Promise<ImportState> {
  const { actor } = await loadShell(locale === 'en' ? 'en' : 'es');
  const { db } = await getRuntime();
  try {
    const result = await importOpeningBalances(actor, db, content);
    if (result.imported > 0) revalidatePath(`/${locale}/inventory`, 'layout');
    return result;
  } catch (error) {
    if (isDomainError(error)) return { error: error.code };
    if (error instanceof Error && error.name === 'ZodError') return { error: 'IMPORT_TOO_LARGE' };
    throw error;
  }
}
