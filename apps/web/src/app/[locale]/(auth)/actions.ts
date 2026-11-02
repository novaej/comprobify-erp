'use server';

import { isDomainError } from '@comprobify/core';
import { redirect } from '@/i18n/navigation';
import { toActionState, type ActionState } from '@/server/actions';
import { safeNextPath } from '@/server/paths';
import { requestMeta } from '@/server/request';
import { getRuntime } from '@/server/runtime';

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
const localeOf = (form: FormData): 'es' | 'en' => (field(form, 'locale') === 'en' ? 'en' : 'es');

export async function signUpAction(_: ActionState, form: FormData): Promise<ActionState> {
  if (field(form, 'password') !== field(form, 'confirmPassword'))
    return { error: 'PASSWORD_MISMATCH' };
  const { identity } = await getRuntime();
  const meta = await requestMeta();
  const state = await toActionState(() =>
    identity.signUp(
      {
        name: field(form, 'name'),
        email: field(form, 'email'),
        password: field(form, 'password'),
        locale: localeOf(form),
      },
      meta,
    ),
  );
  if (state.done) redirect({ href: '/check-email', locale: localeOf(form) });
  return state;
}

export async function signInAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { identity } = await getRuntime();
  const meta = await requestMeta();
  const email = field(form, 'email');
  const state = await toActionState(() =>
    identity.signIn({ email, password: field(form, 'password') }, meta),
  );
  if (state.error === 'EMAIL_NOT_VERIFIED') {
    // Send a fresh link; a rate limit here just means one was sent recently.
    await identity.resendVerification({ email }, meta).catch((error: unknown) => {
      if (!isDomainError(error, 'RATE_LIMITED')) throw error;
    });
  }
  if (state.done)
    redirect({ href: safeNextPath(field(form, 'next')) ?? '/dashboard', locale: localeOf(form) });
  return state;
}

// POST only: the emailed link's GET just shows this form (FR-ONB-1).
export async function verifyEmailAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { identity } = await getRuntime();
  const meta = await requestMeta();
  const state = await toActionState(() =>
    identity.verifyEmail({ token: field(form, 'token') }, meta),
  );
  if (state.done) redirect({ href: '/dashboard', locale: localeOf(form) });
  return state;
}

export async function resendVerificationAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { identity } = await getRuntime();
  const meta = await requestMeta();
  return toActionState(() => identity.resendVerification({ email: field(form, 'email') }, meta));
}

export async function requestPasswordResetAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { identity } = await getRuntime();
  const meta = await requestMeta();
  return toActionState(() => identity.requestPasswordReset({ email: field(form, 'email') }, meta));
}

export async function resetPasswordAction(_: ActionState, form: FormData): Promise<ActionState> {
  if (field(form, 'password') !== field(form, 'confirmPassword'))
    return { error: 'PASSWORD_MISMATCH' };
  const { identity } = await getRuntime();
  const meta = await requestMeta();
  const state = await toActionState(() =>
    identity.resetPassword(
      { token: field(form, 'token'), password: field(form, 'password') },
      meta,
    ),
  );
  if (state.done) redirect({ href: '/login?reason=reset', locale: localeOf(form) });
  return state;
}
