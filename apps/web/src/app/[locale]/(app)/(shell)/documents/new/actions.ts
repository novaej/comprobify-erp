'use server';

import { createInvoice } from '@comprobify/core';
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
