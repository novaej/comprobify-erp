'use server';

import { revalidatePath } from 'next/cache';
import QRCode from 'qrcode';
import { toActionState, type ActionState } from '@/server/actions';
import { requestMeta } from '@/server/request';
import { getRuntime } from '@/server/runtime';

export type SetupState = ActionState & {
  setup?: { qrDataUrl: string; secret: string; backupCodes: string[] };
};

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
const refresh = (form: FormData) =>
  revalidatePath(`/${text(form, 'locale') === 'en' ? 'en' : 'es'}/account`);

// Step one (FR-USR-3): the password confirms it is the user. Returns the QR code, the
// key for typing in by hand, and the backup codes, shown once.
export async function startTwoFactorAction(_: SetupState, form: FormData): Promise<SetupState> {
  const { identity } = await getRuntime();
  const meta = await requestMeta();
  let setup: SetupState['setup'];
  const state = await toActionState(async () => {
    const { totpUri, backupCodes } = await identity.startTwoFactorSetup(
      { password: text(form, 'password') },
      meta,
    );
    setup = {
      qrDataUrl: await QRCode.toDataURL(totpUri, { margin: 1, width: 192 }),
      secret: new URL(totpUri).searchParams.get('secret') ?? '',
      backupCodes,
    };
  });
  return state.done ? { setup } : state;
}

// Step two: a code from the app turns it on. Better Auth rotates the session here.
export async function confirmTwoFactorAction(
  state: SetupState,
  form: FormData,
): Promise<SetupState> {
  const { identity } = await getRuntime();
  const meta = await requestMeta();
  const result = await toActionState(() =>
    identity.confirmTwoFactorSetup({ code: text(form, 'code') }, meta),
  );
  if (result.done) refresh(form);
  return result.done ? { done: true } : { ...result, setup: state.setup };
}

export async function disableTwoFactorAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { identity } = await getRuntime();
  const meta = await requestMeta();
  const state = await toActionState(() =>
    identity.disableTwoFactor({ password: text(form, 'password') }, meta),
  );
  if (state.done) refresh(form);
  return state;
}
