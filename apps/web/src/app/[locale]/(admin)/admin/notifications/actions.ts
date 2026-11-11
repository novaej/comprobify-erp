'use server';

import { markAllPlatformRead, markPlatformRead } from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';

// FR-NOT-2 (ADR-036): a super admin's own notices. Core only ever touches the caller's.

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');

// The bell lives in the platform layout, so a change refreshes all of it.
async function run(
  form: FormData,
  change: (ctx: Awaited<ReturnType<typeof context>>) => Promise<void>,
): Promise<ActionState> {
  const ctx = await context(form);
  const state = await toActionState(() => change(ctx));
  if (state.done) revalidatePath(`/${localeOf(form)}/admin`, 'layout');
  return state;
}

async function context(form: FormData) {
  const { actor } = await loadPlatform(localeOf(form));
  const { db } = await getRuntime();
  return { actor, db };
}

export async function markPlatformReadAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) => markPlatformRead(actor, db, [text(form, 'id')]));
}

export async function markAllPlatformReadAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return run(form, ({ actor, db }) => markAllPlatformRead(actor, db));
}
