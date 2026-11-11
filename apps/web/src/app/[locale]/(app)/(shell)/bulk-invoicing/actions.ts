'use server';

import {
  invoiceableOrderIds,
  isDomainError,
  MAX_BATCH_ITEMS,
  retryFailedItems,
  startCsvBatch,
  startOrderBatch,
  type StartOrderBatchInput,
} from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { redirect } from '@/i18n/navigation';
import { toActionState, type ActionState } from '@/server/actions';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');

// FR-BULK-1. Either the orders ticked, or every order matching the search. Core checks the
// module, the role, the issue point and that every order is the company's; each order's own
// state is checked when its invoice comes up, so one that can't be invoiced fails alone.
export async function startBatchAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = localeOf(form);
  const { actor } = await loadShell(locale);
  const { db, issueDeps } = await getRuntime();
  let orderIds: string[];
  try {
    orderIds =
      text(form, 'scope') === 'all'
        ? await invoiceableOrderIds(
            actor,
            db,
            { query: text(form, 'q') || undefined },
            MAX_BATCH_ITEMS,
          )
        : (JSON.parse(text(form, 'orderIds')) as string[]);
  } catch {
    return { error: 'INVALID_INPUT' };
  }
  const term = text(form, 'term');
  let id: string | undefined;
  const state = await toActionState(async () => {
    id = (
      await startOrderBatch(
        actor,
        db,
        {
          issuePointId: text(form, 'issuePointId'),
          orderIds,
          payment: {
            method: text(form, 'method') as StartOrderBatchInput['payment']['method'],
            term: term === '' ? null : Number(term),
            termUnit: term === '' ? null : (text(form, 'termUnit') as 'dias' | 'meses'),
          },
        },
        { jobs: issueDeps.jobs },
      )
    ).id;
  });
  if (!id) return state;
  revalidatePath(`/${locale}`, 'layout');
  return redirect({ href: `/bulk-invoicing/${id}`, locale });
}

// FR-BULK-3: the batch's failed items go back to the queue (not the invoices SRI rejected).
export async function retryBatchAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = localeOf(form);
  const { actor } = await loadShell(locale);
  const { db, issueDeps } = await getRuntime();
  const state = await toActionState(async () => {
    await retryFailedItems(actor, db, text(form, 'id'), { jobs: issueDeps.jobs });
  });
  if (state.done) revalidatePath(`/${locale}`, 'layout');
  return state;
}

export type CsvBatchState = {
  error?: string;
  problems?: { line: number; code: string; field?: string }[];
};

// FR-BULK-1: a CSV starts a batch of invoices. The file is read in the browser and sent as text;
// core checks every row first, so a file with a wrong row starts nothing and comes back with the
// rows to fix.
export async function startCsvBatchAction(
  locale: string,
  input: { content: string; issuePointId: string; method: string; term: string; termUnit: string },
): Promise<CsvBatchState> {
  const lang = locale === 'en' ? 'en' : 'es';
  const { actor } = await loadShell(lang);
  const { db, issueDeps } = await getRuntime();
  let id: string | undefined;
  try {
    const result = await startCsvBatch(
      actor,
      db,
      {
        text: input.content,
        issuePointId: input.issuePointId,
        payment: {
          method: input.method as StartOrderBatchInput['payment']['method'],
          term: input.term.trim() === '' ? null : Number(input.term),
          termUnit: input.term.trim() === '' ? null : (input.termUnit as 'dias' | 'meses'),
        },
      },
      { jobs: issueDeps.jobs, consumerFinalMaxAmount: issueDeps.consumerFinalMaxAmount },
    );
    if (!result.batch) return { problems: result.problems };
    id = result.batch.id;
  } catch (error) {
    if (isDomainError(error)) return { error: error.code };
    if (error instanceof Error && error.name === 'ZodError') return { error: 'INVALID_INPUT' };
    throw error;
  }
  revalidatePath(`/${lang}`, 'layout');
  return redirect({ href: `/bulk-invoicing/${id}`, locale: lang });
}
