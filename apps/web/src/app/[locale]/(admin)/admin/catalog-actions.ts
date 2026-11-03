'use server';

import {
  addModuleFeature,
  addPlanModule,
  createModule,
  createPlan,
  removeModuleFeature,
  removePlanModule,
  setPlanLimit,
  updateModule,
  updatePlan,
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

// Core checks the flag and every rule on notice; these only adapt the forms (FR-ADM-3).
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
const names = (form: FormData) => ({ nameEs: text(form, 'nameEs'), nameEn: text(form, 'nameEn') });

export async function createPlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    createPlan(actor, db, {
      key: text(form, 'key').toUpperCase(),
      ...names(form),
      selfService: form.get('selfService') === 'on',
    }),
  );
}

export async function updatePlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    updatePlan(actor, db, {
      key: text(form, 'key'),
      ...names(form),
      selfService: form.get('selfService') === 'on',
      status: text(form, 'status'),
    }),
  );
}

export async function addPlanModuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    addPlanModule(actor, db, {
      planKey: text(form, 'planKey'),
      moduleKey: text(form, 'moduleKey'),
    }),
  );
}

export async function removePlanModuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    removePlanModule(actor, db, {
      planKey: text(form, 'planKey'),
      moduleKey: text(form, 'moduleKey'),
    }),
  );
}

export async function setPlanLimitAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    setPlanLimit(actor, db, {
      planKey: text(form, 'planKey'),
      featureKey: text(form, 'featureKey'),
      value: limitValue(form),
    }),
  );
}

export async function createModuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    createModule(actor, db, { key: text(form, 'key').toUpperCase(), ...names(form) }),
  );
}

export async function updateModuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    updateModule(actor, db, {
      key: text(form, 'key'),
      ...names(form),
      status: text(form, 'status'),
    }),
  );
}

export async function addModuleFeatureAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    addModuleFeature(actor, db, {
      moduleKey: text(form, 'moduleKey'),
      featureKey: text(form, 'featureKey'),
    }),
  );
}

export async function removeModuleFeatureAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return run(form, ({ actor, db }) =>
    removeModuleFeature(actor, db, {
      moduleKey: text(form, 'moduleKey'),
      featureKey: text(form, 'featureKey'),
    }),
  );
}
