'use server';

import {
  discardEmailTemplateDraft,
  draftEmailTemplate,
  draftFromVersion,
  isDomainError,
  previewEmailTemplate,
  publishEmailTemplate,
  sendTestEmail,
  type EmailTemplateRef,
} from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';

// FR-NOT-3, FR-ADM-4 (ADR-037): the super admin's email editor. Core checks the flag on every call.

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
// `locale` is the interface language, set by every server action call; the email's own language
// travels as `language`.
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');
const refOf = (form: FormData) =>
  ({ template: text(form, 'template'), locale: text(form, 'language') }) as EmailTemplateRef;
const copyOf = (form: FormData) => ({
  subject: text(form, 'subject'),
  heading: text(form, 'heading'),
  body: text(form, 'body'),
  button: text(form, 'button'),
  footer: text(form, 'footer'),
});

async function run(
  form: FormData,
  change: (ctx: Awaited<ReturnType<typeof context>>) => Promise<void>,
): Promise<ActionState> {
  const ctx = await context(form);
  const state = await toActionState(() => change(ctx));
  if (state.done) revalidatePath(`/${localeOf(form)}/admin/emails`, 'layout');
  return state;
}
async function context(form: FormData) {
  const { actor } = await loadPlatform(localeOf(form));
  const { db, notice } = await getRuntime();
  return { actor, db, notice };
}

export async function saveDraftAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    draftEmailTemplate(actor, db, { ...refOf(form), ...copyOf(form) }),
  );
}

export async function publishAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) => publishEmailTemplate(actor, db, refOf(form)));
}

export async function discardAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) => discardEmailTemplateDraft(actor, db, refOf(form)));
}

export async function draftFromVersionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    draftFromVersion(actor, db, { ...refOf(form), version: Number(text(form, 'version')) }),
  );
}

// To the signed-in super admin's own address, with the text on the screen, saved or not.
export async function sendTestAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db, notice }) =>
    sendTestEmail(actor, db, { ...refOf(form), copy: copyOf(form) }, notice).then(() => undefined),
  );
}

export type PreviewState = { error: string } | { subject: string; html: string };

export async function previewAction(form: FormData): Promise<PreviewState> {
  const { actor, db } = await context(form);
  try {
    const { subject, html } = await previewEmailTemplate(actor, db, {
      ...refOf(form),
      ...copyOf(form),
    });
    return { subject, html };
  } catch (error) {
    if (isDomainError(error)) return { error: error.code };
    if (error instanceof Error && error.name === 'ZodError') return { error: 'INVALID_INPUT' };
    throw error;
  }
}
