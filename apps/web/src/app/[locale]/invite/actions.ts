'use server';

import {
  acceptInvitation,
  chooseActiveOrganization,
  createVerifiedUser,
  getInvitation,
  listOrganizations,
  switchOrganization,
  systemClock,
} from '@comprobify/core';
import { redirect } from '@/i18n/navigation';
import { toActionState, type ActionState } from '@/server/actions';
import { requestMeta } from '@/server/request';
import { getRuntime } from '@/server/runtime';
import { getSession } from '@/server/session';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
const localeOf = (form: FormData): 'es' | 'en' => (text(form, 'locale') === 'en' ? 'en' : 'es');

// POST only: the emailed link's GET just shows the invitation (Appendix B, lesson 5).
export async function acceptAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await getSession();
  const locale = localeOf(form);
  if (session.status !== 'active') return { error: 'SIGN_IN_FIRST' };
  const { db } = await getRuntime();
  const state = await toActionState(async () => {
    const joined = await acceptInvitation(
      db,
      { token: text(form, 'token'), userId: session.user.id, userEmail: session.user.email },
      systemClock,
    );
    // Open the organization just joined, as the switcher would.
    const active = chooseActiveOrganization(
      (await listOrganizations(db, session.user.id)).filter(
        (entry) => entry.realTenantId === joined.realTenantId,
      ),
      null,
    );
    if (active)
      await switchOrganization(db, {
        userId: session.user.id,
        sessionId: session.sessionId,
        tenantId: active.tenantId,
      });
  });
  if (state.done) redirect({ href: '/dashboard', locale });
  return state;
}

// FR-USR-1: a new person sets a password. The link proved the email, so the account
// starts verified; then they are signed in and join.
export async function acceptAsNewUserAction(_: ActionState, form: FormData): Promise<ActionState> {
  if (text(form, 'password') !== text(form, 'confirmPassword'))
    return { error: 'PASSWORD_MISMATCH' };
  const locale = localeOf(form);
  const token = text(form, 'token');
  const { db, auth, identity } = await getRuntime();
  const invitation = await getInvitation(db, token, systemClock);
  if (invitation?.state !== 'pending') return { error: 'INVITATION_INVALID' };
  if (invitation.hasAccount) return { error: 'EMAIL_TAKEN' };

  const state = await toActionState(async () => {
    const { id } = await createVerifiedUser(auth, {
      name: text(form, 'name'),
      email: invitation.email,
      password: text(form, 'password'),
      locale,
    });
    await identity.signIn(
      { email: invitation.email, password: text(form, 'password') },
      await requestMeta(),
    );
    // The new session's first page picks this organization: it is the only one.
    await acceptInvitation(db, { token, userId: id, userEmail: invitation.email }, systemClock);
  });
  if (state.done) redirect({ href: '/dashboard', locale });
  return state;
}
