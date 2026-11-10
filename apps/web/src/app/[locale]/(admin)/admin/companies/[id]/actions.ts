'use server';

import {
  addModule,
  changePlan,
  clearLimit,
  clearOverride,
  reactivateCompany,
  removeModule,
  setBilling,
  setLimit,
  setNegotiatedPrice,
  setAddOnComplimentary,
  setOverride,
  moveToCustom,
  startCustomBilling,
  suspendCompany,
  type SuspensionReason,
} from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');
// Blank or "unlimited" is null; anything not a whole number fails core's schema.
const limitValue = (form: FormData): number | null =>
  form.get('unlimited') === 'on' || text(form, 'value') === ''
    ? null
    : /^\d+$/.test(text(form, 'value'))
      ? Number(text(form, 'value'))
      : Number.NaN;

// Core checks the super admin flag on every call; these only adapt the form.
async function run(
  form: FormData,
  change: (ctx: Awaited<ReturnType<typeof context>>) => Promise<void>,
): Promise<ActionState> {
  const ctx = await context(form);
  const state = await toActionState(() => change(ctx));
  if (state.done) revalidatePath(`/${localeOf(form)}/admin/companies/${ctx.realTenantId}`);
  return state;
}
async function context(form: FormData) {
  const { actor } = await loadPlatform(localeOf(form));
  const { db, jobs, env } = await getRuntime();
  // Billing emails: the payer hears of a price that changes what it owes.
  return {
    actor,
    db,
    realTenantId: text(form, 'realTenantId'),
    notice: { jobs, appUrl: env.APP_URL },
  };
}

export async function changePlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db, realTenantId }) =>
    changePlan(actor, db, { realTenantId, planKey: text(form, 'planKey') }),
  );
}

export async function setBillingAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db, realTenantId }) =>
    setBilling(
      actor,
      db,
      form.get('complimentary') === 'on'
        ? { realTenantId, complimentary: true, reason: text(form, 'reason') }
        : { realTenantId, complimentary: false },
    ),
  );
}

export async function setPriceAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db, realTenantId, notice }) =>
    setNegotiatedPrice(
      actor,
      db,
      { realTenantId, monthlyPrice: text(form, 'monthlyPrice').replace(',', '.') || null },
      notice,
    ),
  );
}

export async function addModuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db, realTenantId }) =>
    addModule(actor, db, {
      realTenantId,
      moduleKey: text(form, 'moduleKey'),
      complimentaryReason: form.get('complimentary') === 'on' ? text(form, 'reason') : null,
    }),
  );
}

export async function removeModuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db, realTenantId }) =>
    removeModule(actor, db, { realTenantId, moduleKey: text(form, 'moduleKey') }),
  );
}

export async function setLimitAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db, realTenantId }) =>
    setLimit(actor, db, {
      realTenantId,
      featureKey: text(form, 'featureKey'),
      value: limitValue(form),
    }),
  );
}

export async function clearLimitAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db, realTenantId }) =>
    clearLimit(actor, db, { realTenantId, featureKey: text(form, 'featureKey') }),
  );
}

export async function setOverrideAction(_: ActionState, form: FormData): Promise<ActionState> {
  const effect = text(form, 'effect') as 'GRANT' | 'REVOKE' | 'LIMIT';
  return run(form, ({ actor, db, realTenantId }) =>
    setOverride(actor, db, {
      realTenantId,
      featureKey: text(form, 'featureKey'),
      effect,
      limitValue: effect === 'LIMIT' ? limitValue(form) : null,
      reason: text(form, 'reason'),
    }),
  );
}

export async function clearOverrideAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db, realTenantId }) =>
    clearOverride(actor, db, { realTenantId, featureKey: text(form, 'featureKey') }),
  );
}

// FR-BILL-9: the company keeps reading its data and can do nothing else until reactivated.
export async function suspendAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db, realTenantId }) =>
    suspendCompany(actor, db, {
      realTenantId,
      reason: text(form, 'reason') as SuspensionReason,
      note: text(form, 'note') || null,
    }),
  );
}

export async function reactivateAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db, realTenantId }) => reactivateCompany(actor, db, { realTenantId }));
}

// ADR-035: an add-on given without charge, with its reason, or charged again.
export async function complimentaryAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db, realTenantId }) =>
    setAddOnComplimentary(actor, db, {
      realTenantId,
      moduleKey: text(form, 'moduleKey'),
      reason: form.get('complimentary') === 'on' ? text(form, 'reason') : null,
    }),
  );
}

// ADR-035: Personalizado's first paid period, at the negotiated price.
export async function startCustomBillingAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return run(form, async ({ actor, db, realTenantId }) => {
    await startCustomBilling(actor, db, {
      realTenantId,
      interval: text(form, 'interval') === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
    });
  });
}

// ADR-035: a paying company to Personalizado: now if it costs more, else at the period end.
export async function moveToCustomAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, async ({ actor, db, realTenantId, notice }) => {
    await moveToCustom(
      actor,
      db,
      { realTenantId, monthlyPrice: text(form, 'monthlyPrice').replace(',', '.') },
      notice,
    );
  });
}
