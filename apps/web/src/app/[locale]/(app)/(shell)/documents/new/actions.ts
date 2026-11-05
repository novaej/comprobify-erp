'use server';

import { correctInvoice, createInvoice, removeTemplate, saveTemplate } from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { redirect } from '@/i18n/navigation';
import { toActionState, type ActionState } from '@/server/actions';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

// FR-DOC-2. Core validates everything; the form only helps.
export async function createInvoiceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = form.get('locale') === 'en' ? 'en' : 'es';
  const { actor } = await loadShell(locale);
  const { db, issueDeps } = await getRuntime();
  const raw = form.get('payload');
  let payload: unknown;
  try {
    payload = JSON.parse(typeof raw === 'string' ? raw : '');
  } catch {
    return { error: 'INVALID_INPUT' };
  }
  let id: string | undefined;
  const state = await toActionState(async () => {
    id = (await createInvoice(actor, db, payload as Parameters<typeof createInvoice>[2], issueDeps))
      .id;
  });
  if (!id) return state;
  return redirect({ href: `/documents/${id}`, locale });
}

// FR-DOC-7: the same row and number, sent again.
export async function correctInvoiceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = form.get('locale') === 'en' ? 'en' : 'es';
  const { actor } = await loadShell(locale);
  const { db, issueDeps } = await getRuntime();
  const raw = form.get('payload');
  const id = form.get('id');
  let payload: unknown;
  try {
    payload = JSON.parse(typeof raw === 'string' ? raw : '');
  } catch {
    return { error: 'INVALID_INPUT' };
  }
  if (typeof id !== 'string') return { error: 'INVALID_INPUT' };
  let done = false;
  const state = await toActionState(async () => {
    await correctInvoice(actor, db, id, payload as Parameters<typeof correctInvoice>[3], issueDeps);
    done = true;
  });
  if (!done) return state;
  return redirect({ href: `/documents/${id}`, locale });
}

// FR-MD-5: core validates the content against the invoice's own rules.
export async function saveTemplateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = form.get('locale') === 'en' ? 'en' : 'es';
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  const name = form.get('name');
  const raw = form.get('content');
  let content: unknown;
  try {
    content = JSON.parse(typeof raw === 'string' ? raw : '');
  } catch {
    return { error: 'INVALID_INPUT' };
  }
  const state = await toActionState(async () => {
    await saveTemplate(actor, db, {
      name: typeof name === 'string' ? name : '',
      content: content as Parameters<typeof saveTemplate>[2]['content'],
    });
  });
  if (state.done) revalidatePath(`/${locale}/documents/new`);
  return state;
}

export async function removeTemplateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = form.get('locale') === 'en' ? 'en' : 'es';
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  const id = form.get('id');
  const state = await toActionState(() =>
    removeTemplate(actor, db, typeof id === 'string' ? id : ''),
  );
  if (state.done) revalidatePath(`/${locale}/documents/new`);
  return state;
}
