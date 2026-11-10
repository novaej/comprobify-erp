'use server';

import {
  markAllRead,
  markRead,
  setNotificationPreference,
  type NotificationChannel,
  type NotificationType,
} from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

// FR-NOT-1: a member's own notifications and choices. Core only ever touches the caller's.

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');

// The bell lives in the shell, so a change refreshes the whole layout.
async function run(
  form: FormData,
  change: (ctx: Awaited<ReturnType<typeof context>>) => Promise<void>,
): Promise<ActionState> {
  const ctx = await context(form);
  const state = await toActionState(() => change(ctx));
  if (state.done) revalidatePath(`/${localeOf(form)}`, 'layout');
  return state;
}

async function context(form: FormData) {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  return { actor, db };
}

export async function markReadAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) => markRead(actor, db, [text(form, 'id')]));
}

export async function markAllReadAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) => markAllRead(actor, db));
}

export async function setPreferenceAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    setNotificationPreference(actor, db, {
      type: text(form, 'type') as NotificationType,
      channel: text(form, 'channel') as NotificationChannel,
      enabled: text(form, 'enabled') === 'true',
    }),
  );
}
