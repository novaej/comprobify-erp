'use server';

import {
  createBranch,
  createIssuePoint,
  setIssuePointDocumentType,
  setIssuePointPaused,
  updateBranch,
  updateCompanyProfile,
} from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};
const optional = (form: FormData, name: string) => text(form, name) || null;
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');

// Core checks the role, the plan's limits and features (FR-ROLE-3, FR-PLAN-3).
async function run(form: FormData, change: Parameters<typeof toActionState>[0]) {
  const state = await toActionState(change);
  // The shell shows the company's name, so its layout is refreshed too (mistake 28).
  if (state.done) revalidatePath(`/${localeOf(form)}`, 'layout');
  return state;
}

export async function updateProfileAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  return run(form, () =>
    updateCompanyProfile(actor, db, {
      tradeName: optional(form, 'tradeName'),
      mainAddress: text(form, 'mainAddress'),
      requiredAccounting: form.get('requiredAccounting') === 'on',
      specialTaxpayerResolution: optional(form, 'specialTaxpayerResolution'),
      withholdingAgentResolution: optional(form, 'withholdingAgentResolution'),
      taxRegime: text(form, 'taxRegime') as 'GENERAL',
    }),
  );
}

export async function saveBranchAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  const branchId = text(form, 'branchId');
  const fields = { name: text(form, 'name'), address: text(form, 'address') };
  return run(form, () =>
    branchId
      ? updateBranch(actor, db, { branchId, ...fields })
      : createBranch(actor, db, { code: text(form, 'code'), ...fields }),
  );
}

export async function createIssuePointAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  return run(form, () =>
    createIssuePoint(actor, db, { branchId: text(form, 'branchId'), code: text(form, 'code') }),
  );
}

export async function setDocumentTypesAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  const issuePointId = text(form, 'issuePointId');
  const wanted = new Set(form.getAll('documentTypes').map(String));
  const current = new Set(text(form, 'current').split(',').filter(Boolean));
  return run(form, async () => {
    for (const documentType of text(form, 'offered').split(',').filter(Boolean)) {
      const enabled = wanted.has(documentType);
      if (enabled !== current.has(documentType))
        await setIssuePointDocumentType(actor, db, { issuePointId, documentType, enabled });
    }
  });
}

export async function setPausedAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadShell(localeOf(form));
  const { db } = await getRuntime();
  return run(form, () =>
    setIssuePointPaused(actor, db, {
      issuePointId: text(form, 'issuePointId'),
      canIssue: text(form, 'canIssue') === 'true',
    }),
  );
}
