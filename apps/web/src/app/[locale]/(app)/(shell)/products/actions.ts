'use server';

import { createProduct, setProductActive, updateProduct } from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};
const optional = (form: FormData, name: string) => text(form, name) || null;
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');

// Prices stay strings, so no float stands in for one (ADR-012). Core validates the rest.
function fields(form: FormData) {
  const names = form.getAll('detailName').map(String);
  const values = form.getAll('detailValue').map(String);
  return {
    code: text(form, 'code'),
    auxiliaryCode: optional(form, 'auxiliaryCode'),
    name: text(form, 'name'),
    description: optional(form, 'description'),
    kind: text(form, 'kind') as 'GOOD',
    unit: optional(form, 'unit'),
    price: text(form, 'price').replace(',', '.'),
    cost: optional(form, 'cost')?.replace(',', '.') ?? null,
    ivaRateCode: text(form, 'ivaRateCode'),
    tracksStock: form.get('tracksStock') === 'on',
    additionalDetails: names
      .map((name, index) => ({ name: name.trim(), value: (values[index] ?? '').trim() }))
      .filter((detail) => detail.name || detail.value),
  };
}

export async function saveProductAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  const id = text(form, 'id');
  const state = await toActionState(async () => {
    if (id) await updateProduct(actor, db, id, fields(form));
    else await createProduct(actor, db, fields(form));
  });
  if (state.done) revalidatePath(`/${localeOf(form)}/products`);
  return state;
}

export async function setProductActiveAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  const state = await toActionState(() =>
    setProductActive(actor, db, { id: text(form, 'id'), active: text(form, 'active') === 'true' }),
  );
  if (state.done) revalidatePath(`/${localeOf(form)}/products`);
  return state;
}
