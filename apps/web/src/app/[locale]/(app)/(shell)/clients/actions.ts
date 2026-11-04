'use server';

import { createClient, setClientActive, updateClient } from '@comprobify/core';
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

// Core validates every field and checks the role and feature (FR-MD-2, FR-ROLE-3).
function fields(form: FormData) {
  const term = text(form, 'paymentTerm');
  return {
    idType: text(form, 'idType'),
    identification: text(form, 'identification'),
    name: text(form, 'name'),
    emails: text(form, 'emails')
      .split(/[,;\s]+/)
      .filter(Boolean),
    phone: optional(form, 'phone'),
    address: optional(form, 'address'),
    // Not a whole number: NaN, which core's schema refuses.
    paymentTerm: term === '' ? null : /^\d+$/.test(term) ? Number(term) : Number.NaN,
    paymentTermUnit: term === '' ? null : (text(form, 'paymentTermUnit') as 'dias'),
  };
}

export async function saveClientAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  const id = text(form, 'id');
  const state = await toActionState(async () => {
    if (id) await updateClient(actor, db, id, fields(form));
    else await createClient(actor, db, fields(form));
  });
  if (state.done) revalidatePath(`/${localeOf(form)}/clients`);
  return state;
}

export async function setClientActiveAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  const state = await toActionState(() =>
    setClientActive(actor, db, { id: text(form, 'id'), active: text(form, 'active') === 'true' }),
  );
  if (state.done) revalidatePath(`/${localeOf(form)}/clients`);
  return state;
}
