'use server';

import { onboardOrganization, switchOrganization, systemClock } from '@comprobify/core';
import { redirect } from '@/i18n/navigation';
import { toActionState, type ActionState } from '@/server/actions';
import { getRuntime } from '@/server/runtime';
import { getSession } from '@/server/session';

const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

const rawText = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

const fileBytes = async (form: FormData, name: string): Promise<Uint8Array<ArrayBuffer> | null> => {
  const value = form.get(name);
  return value instanceof File && value.size > 0 ? new Uint8Array(await value.arrayBuffer()) : null;
};

export async function onboardAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await getSession();
  const locale = text(form, 'locale') === 'en' ? 'en' : 'es';
  if (session.status !== 'active') return redirect({ href: '/login', locale });

  const certificate = await fileBytes(form, 'certificate');
  if (!certificate) return { error: 'CERTIFICATE_REQUIRED' };
  const { db, keyCipher } = await getRuntime();

  let twinTenantId = '';
  const state = await toActionState(async () => {
    const created = await onboardOrganization(
      db,
      {
        ownerUserId: session.user.id,
        ruc: text(form, 'ruc'),
        legalName: text(form, 'legalName'),
        tradeName: text(form, 'tradeName') || null,
        mainAddress: text(form, 'mainAddress'),
        requiredAccounting: form.get('requiredAccounting') === 'on',
        branch: {
          code: text(form, 'branchCode') || '001',
          name: text(form, 'branchName') || 'Matriz',
          address: text(form, 'branchAddress') || null,
        },
        issuePointCode: text(form, 'issuePointCode') || '001',
        // Not trimmed: a password may start or end with a space.
        certificate: { file: certificate, password: rawText(form, 'certificatePassword') },
        logo: await fileBytes(form, 'logo'),
      },
      { keyCipher, clock: systemClock },
    );
    twinTenantId = created.twinTenantId;
    // The user starts in the twin and can issue test documents right away (FR-ONB-4).
    await switchOrganization(db, {
      userId: session.user.id,
      sessionId: session.sessionId,
      tenantId: created.twinTenantId,
    });
  });
  if (state.done && twinTenantId) redirect({ href: '/dashboard?welcome=1', locale });
  return state;
}
