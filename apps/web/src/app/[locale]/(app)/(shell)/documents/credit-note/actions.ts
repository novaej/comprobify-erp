'use server';

import { correctCreditNote, createCreditNote } from '@comprobify/core';
import { redirect } from '@/i18n/navigation';
import { toActionState, type ActionState } from '@/server/actions';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

const localeOf = (form: FormData) => (form.get('locale') === 'en' ? 'en' : 'es');
const payloadOf = (form: FormData): unknown => {
  const raw = form.get('payload');
  try {
    return JSON.parse(typeof raw === 'string' ? raw : '');
  } catch {
    return undefined;
  }
};

// FR-DOC-9. Core holds every line to the invoice's balance; the form only helps.
export async function createCreditNoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = localeOf(form);
  const { actor } = await loadShell(locale);
  const { db, issueDeps } = await getRuntime();
  const payload = payloadOf(form);
  if (payload === undefined) return { error: 'INVALID_INPUT' };
  let id: string | undefined;
  const state = await toActionState(async () => {
    id = (
      await createCreditNote(
        actor,
        db,
        payload as Parameters<typeof createCreditNote>[2],
        issueDeps,
      )
    ).id;
  });
  if (!id) return state;
  return redirect({ href: `/documents/${id}`, locale });
}

// FR-DOC-7: the same row and number, sent again.
export async function correctCreditNoteAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeOf(form);
  const { actor } = await loadShell(locale);
  const { db, issueDeps } = await getRuntime();
  const payload = payloadOf(form);
  const id = form.get('id');
  if (payload === undefined || typeof id !== 'string') return { error: 'INVALID_INPUT' };
  let done = false;
  const state = await toActionState(async () => {
    await correctCreditNote(
      actor,
      db,
      id,
      payload as Parameters<typeof correctCreditNote>[3],
      issueDeps,
    );
    done = true;
  });
  if (!done) return state;
  return redirect({ href: `/documents/${id}`, locale });
}
