'use server';

import { requestReissue, resendDocumentEmail, voidDocument } from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');

// Core checks the role, the plan and the status of each (FR-ROLE-3).
async function run(form: FormData, fn: (id: string) => Promise<void>): Promise<ActionState> {
  const id = text(form, 'id');
  const state = await toActionState(() => fn(id));
  if (state.done) revalidatePath(`/${localeOf(form)}/documents/${id}`);
  return state;
}

export async function reissueAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db, jobs } = await getRuntime();
  return run(form, (id) =>
    requestReissue(actor, db, id, { issueDate: text(form, 'issueDate') }, { jobs }),
  );
}

export async function voidAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db, sri } = await getRuntime();
  return run(form, async (id) => {
    await voidDocument(
      actor,
      db,
      id,
      { attestedVoidedAtSri: text(form, 'attested') === 'true' },
      { sri },
    );
  });
}

export async function resendAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db, jobs } = await getRuntime();
  return run(form, (id) => resendDocumentEmail(actor, db, id, { jobs }));
}
