'use server';

import {
  changeRole,
  inviteMember,
  removeMember,
  revokeInvitation,
  setIssuePointAccess,
  setTwoFactorRequirement,
} from '@comprobify/core';
import { createRateLimiter, systemClock } from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');

// Core checks every permission; these only adapt the form (FR-ROLE-3).
async function run(
  form: FormData,
  change: Parameters<typeof toActionState>[0],
): Promise<ActionState> {
  const state = await toActionState(change);
  if (state.done) revalidatePath(`/${localeOf(form)}/users`);
  return state;
}

export async function inviteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db, jobs, env } = await getRuntime();
  return run(form, () =>
    inviteMember(
      actor,
      db,
      { email: text(form, 'email'), role: text(form, 'role') as 'VIEWER', locale: localeOf(form) },
      {
        jobs,
        appUrl: env.APP_URL,
        rateLimiter: createRateLimiter(db.identity, () => systemClock.now()),
      },
    ),
  );
}

export async function changeRoleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  return run(form, () =>
    changeRole(actor, db, { userId: text(form, 'userId'), role: text(form, 'role') }),
  );
}

export async function removeMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  return run(form, () => removeMember(actor, db, text(form, 'userId')));
}

export async function revokeInvitationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  return run(form, () => revokeInvitation(actor, db, text(form, 'invitationId')));
}

export async function setAccessAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  const points = form
    .getAll('points')
    .filter((value): value is string => typeof value === 'string')
    .map((value) => {
      const [branchCode = '', pointCode = ''] = value.split('-');
      return { branchCode, pointCode };
    });
  return run(form, () => setIssuePointAccess(actor, db, { userId: text(form, 'userId'), points }));
}

export async function setTwoFactorRequirementAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  return run(form, () => setTwoFactorRequirement(actor, db, form.get('required') === 'on'));
}
