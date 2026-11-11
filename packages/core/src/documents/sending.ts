import type { Logger } from '@comprobify/config/logger';
import { and, eq, schema, sql, type Database, type Tx } from '@comprobify/db';
import type { Jobs } from '../jobs';
import { endOfEcuadorDay, type Clock } from '../kernel';
import { SRI_SEQUENTIAL_TAKEN, SriTransportError, type SriClient, type SriMessage } from '../sri';
import { AUTHORIZATION_OVERDUE_AFTER, nextAuthorizationCheck, nextSendAttempt } from './calendar';
import { announce } from '../notifications';
import { recordExchange } from './exchanges';
import { documentNumber } from './number';
import { stockOnAuthorized } from './stock';
import { assertTransition, type DocumentStatus } from './status';

// FR-DOC-4 and FR-DOC-5. Each handler re-reads the document under a row lock, acts only
// if its status still calls for it, and calls SRI outside any transaction, so a slow SRI
// never holds a lock. Only transport errors are retried; a clean answer never is.

export type SendingDeps = {
  db: Database;
  sri: SriClient;
  jobs: Pick<Jobs, 'enqueue'>;
  clock: Clock;
  logger: Logger;
  random?: () => number;
};

export type DocumentRef = { tenantId: string; documentId: string };

export type Row = typeof schema.documents.$inferSelect;
type Changes = Partial<typeof schema.documents.$inferInsert>;

export const SENDABLE: readonly DocumentStatus[] = ['SIGNED', 'PENDING_SEND', 'SEND_FAILED'];

const deadlineOf = (row: Row) => row.retryUntil ?? endOfEcuadorDay(row.issueDate);

export async function locked(tx: Tx, ref: DocumentRef): Promise<Row | undefined> {
  const [row] = await tx.db
    .select()
    .from(schema.documents)
    .where(
      and(eq(schema.documents.id, ref.documentId), eq(schema.documents.tenantId, ref.tenantId)),
    )
    .for('update');
  return row;
}

// FR-DOC-13: every transition writes an event, with SRI's raw answer when there is one.
export async function transition(
  tx: Tx,
  row: Row,
  to: DocumentStatus,
  changes: Changes = {},
  event: {
    type?: 'STATUS_CHANGED' | 'REISSUED' | 'CORRECTED' | 'VOIDED';
    details?: Record<string, unknown>;
    actorUserId?: string | null;
  } = {},
): Promise<Row> {
  assertTransition(row.status, to);
  const [updated] = await tx.db
    .update(schema.documents)
    .set({ ...changes, status: to, updatedAt: sql`now()` })
    .where(eq(schema.documents.id, row.id))
    .returning();
  await tx.db.insert(schema.documentEvents).values({
    tenantId: row.tenantId,
    documentId: row.id,
    type: event.type ?? 'STATUS_CHANGED',
    fromStatus: row.status,
    toStatus: to,
    details: event.details ?? {},
    actorUserId: event.actorUserId ?? null,
  });
  return updated!;
}

async function update(tx: Tx, row: Row, changes: Changes): Promise<void> {
  await tx.db.update(schema.documents).set(changes).where(eq(schema.documents.id, row.id));
}

// FR-NOT-2: tell the company what happened to a document, in this transaction.
export const tell = (
  jobs: SendingDeps['jobs'],
  tx: Tx,
  row: Pick<Row, 'id' | 'tenantId' | 'series' | 'sequential'>,
  type:
    | 'DOCUMENT_REJECTED'
    | 'DOCUMENT_SEND_FAILED'
    | 'DOCUMENT_OVERDUE'
    | 'DOCUMENT_REISSUED'
    | 'DOCUMENTS_AUTHORIZED',
  params: Record<string, string> = {},
) =>
  announce(jobs, tx, {
    tenantId: row.tenantId,
    type,
    params: { number: documentNumber(row), ...params },
    link: `/documents/${row.id}`,
  });

const summary = (messages: SriMessage[]) =>
  messages.map(({ identifier, message, additionalInfo }) => ({
    identifier,
    message,
    additionalInfo,
  }));

async function scheduleAuthorization(deps: SendingDeps, tx: Tx, row: Row, checks: number) {
  const now = deps.clock.now();
  await deps.jobs.enqueue(
    tx,
    'sri.authorize',
    { tenantId: row.tenantId, documentId: row.id },
    { startAfter: nextAuthorizationCheck(checks, row.receivedAt ?? now, now) },
  );
}

// To RECEIVED from wherever a send can be, through the machine's own steps.
async function toReceived(tx: Tx, row: Row, now: Date, details: Record<string, unknown>) {
  let current = row;
  if (current.status === 'SIGNED') current = await transition(tx, current, 'PENDING_SEND');
  return transition(tx, current, 'RECEIVED', { receivedAt: now }, { details });
}

export async function sendDocument(deps: SendingDeps, ref: DocumentRef): Promise<void> {
  const { db, sri, clock, logger } = deps;
  const now = clock.now();
  const ready = await db.withTenant({ tenantId: ref.tenantId }, async (tx) => {
    const row = await locked(tx, ref);
    if (!row || !SENDABLE.includes(row.status)) return null;
    if (now > deadlineOf(row)) return 'deadline' as const;
    if (row.status === 'PENDING_SEND') return row;
    return transition(tx, row, 'PENDING_SEND', {}, { details: { attempt: row.sendAttempts + 1 } });
  });
  if (ready === null) return;
  if (ready === 'deadline') return checkAfterDeadline(deps, ref);

  let outcome: Awaited<ReturnType<SriClient['send']>> | SriTransportError;
  try {
    outcome = await sri.send(ready.signedXml!, ready.ambiente);
  } catch (error) {
    if (!(error instanceof SriTransportError)) throw error;
    outcome = error;
  }

  await db.withTenant({ tenantId: ref.tenantId }, async (tx) => {
    const row = await locked(tx, ref);
    // Recorded whatever happens next, even if another job already moved the document on.
    await recordExchange(tx, ref, 'reception', outcome);
    if (row?.status !== 'PENDING_SEND') return;
    if (outcome instanceof SriTransportError) {
      const failures = row.sendAttempts + 1;
      await transition(
        tx,
        row,
        'SEND_FAILED',
        { sendAttempts: failures },
        {
          details: {
            operation: 'reception',
            source: outcome.source,
            error: outcome.message,
            httpStatus: outcome.httpStatus,
          },
        },
      );
      const next = nextSendAttempt(failures, now, deadlineOf(row), deps.random);
      await deps.jobs.enqueue(tx, next ? 'sri.send' : 'sri.deadline', ref, {
        startAfter: next ?? deadlineOf(row),
      });
      return;
    }
    const details = {
      operation: 'reception',
      source: outcome.source,
      messages: summary(outcome.messages),
    };
    if (outcome.status === 'RECEIVED') {
      const received = await toReceived(tx, row, now, details);
      await scheduleAuthorization(deps, tx, received, 0);
      return;
    }
    const taken = outcome.messages.some((message) => message.identifier === SRI_SEQUENTIAL_TAKEN);
    await tell(deps.jobs, tx, row, 'DOCUMENT_REJECTED');
    await transition(
      tx,
      row,
      'RETURNED',
      {},
      {
        details: { ...details, sequentialTaken: taken },
      },
    );
    // FR-DOC-6: another key holds this number; a person must look before anything else.
    if (taken)
      logger.error('SRI says the sequential is already registered', {
        event: 'documents.sequential_taken',
        tenantId: row.tenantId,
        accessKey: row.accessKey,
      });
  });
}

type AuthorizationAnswer = Awaited<ReturnType<SriClient['authorization']>>;

// SRI has the document after all: on to RECEIVED and its answer, through the machine.
export async function applyFinalAnswer(
  jobs: SendingDeps['jobs'],
  tx: Tx,
  row: Row,
  answer: Exclude<AuthorizationAnswer, { status: 'PENDING' }>,
  now: Date,
  operation: string,
): Promise<Row> {
  const details = { operation, source: answer.source, messages: summary(answer.messages) };
  const received = await toReceived(tx, row, now, details);
  if (answer.status === 'AUTHORIZED') return authorize(jobs, tx, received, answer, details);
  await tell(jobs, tx, received, 'DOCUMENT_REJECTED');
  return transition(tx, received, 'NOT_AUTHORIZED', {}, { details });
}

// FR-DOC-11: the buyer's copy goes out in the same transaction as the authorization, and the
// stock moves with it (ADR-020).
async function authorize(
  jobs: SendingDeps['jobs'],
  tx: Tx,
  row: Row,
  answer: Extract<AuthorizationAnswer, { status: 'AUTHORIZED' }>,
  details: Record<string, unknown>,
): Promise<Row> {
  const authorized = await transition(
    tx,
    row,
    'AUTHORIZED',
    {
      authorizationNumber: answer.authorizationNumber,
      authorizedAt: answer.authorizedAt,
      authorizationXml: answer.authorizationXml,
    },
    { details },
  );
  await stockOnAuthorized(tx, authorized);
  await tell(jobs, tx, authorized, 'DOCUMENTS_AUTHORIZED');
  await jobs.enqueue(tx, 'documents.email', {
    tenantId: row.tenantId,
    documentId: row.id,
    resend: false,
  });
  return authorized;
}

// FR-DOC-4: once the issue day is over, one read-only question to SRI.
export async function checkAfterDeadline(deps: SendingDeps, ref: DocumentRef): Promise<void> {
  const { db, sri, clock } = deps;
  const now = clock.now();
  const row = await db.withTenant({ tenantId: ref.tenantId }, (tx) => locked(tx, ref));
  if (!row || !SENDABLE.includes(row.status) || row.deadlineCheckedAt) return;

  let answer: Awaited<ReturnType<SriClient['authorization']>> | null;
  let failure: SriTransportError | null = null;
  try {
    answer = await sri.authorization(row.accessKey, row.ambiente);
  } catch (error) {
    if (!(error instanceof SriTransportError)) throw error;
    answer = null;
    failure = error;
  }

  await db.withTenant({ tenantId: ref.tenantId }, async (tx) => {
    await recordExchange(tx, ref, 'authorization', answer ?? failure!);
    let current = await locked(tx, ref);
    if (!current || !SENDABLE.includes(current.status) || current.deadlineCheckedAt) return;
    const checked = { deadlineCheckedAt: now, sriUnreachable: answer === null };
    if (answer && answer.status !== 'PENDING') {
      current = await applyFinalAnswer(deps.jobs, tx, current, answer, now, 'deadline-check');
      await update(tx, current, checked);
      return;
    }
    // Not at SRI, or SRI couldn't be asked: SEND_FAILED, for the next-day re-issue.
    if (current.status === 'SIGNED') current = await transition(tx, current, 'PENDING_SEND');
    if (current.status === 'PENDING_SEND')
      current = await transition(
        tx,
        current,
        'SEND_FAILED',
        {},
        {
          details: {
            operation: 'deadline-check',
            source: (answer ?? failure)?.source,
            sriUnreachable: answer === null,
          },
        },
      );
    await update(tx, current, checked);
    await tell(deps.jobs, tx, current, 'DOCUMENT_SEND_FAILED');
  });
}

export async function checkAuthorization(deps: SendingDeps, ref: DocumentRef): Promise<void> {
  const { db, sri } = deps;
  const row = await db.withTenant({ tenantId: ref.tenantId }, (tx) => locked(tx, ref));
  if (row?.status !== 'RECEIVED') return;

  let answer: Awaited<ReturnType<SriClient['authorization']>> | null;
  let failure: SriTransportError | null = null;
  try {
    answer = await sri.authorization(row.accessKey, row.ambiente);
  } catch (error) {
    if (!(error instanceof SriTransportError)) throw error;
    answer = null;
    failure = error;
  }

  await db.withTenant({ tenantId: ref.tenantId }, async (tx) => {
    await recordExchange(tx, ref, 'authorization', answer ?? failure!);
    const current = await locked(tx, ref);
    if (current?.status !== 'RECEIVED') return;
    if (answer?.status === 'AUTHORIZED') {
      await authorize(deps.jobs, tx, current, answer, {
        operation: 'authorization',
        source: answer.source,
        messages: summary(answer.messages),
      });
      return;
    }
    if (answer?.status === 'NOT_AUTHORIZED') {
      await tell(deps.jobs, tx, current, 'DOCUMENT_REJECTED');
      await transition(
        tx,
        current,
        'NOT_AUTHORIZED',
        {},
        {
          details: {
            operation: 'authorization',
            source: answer.source,
            messages: summary(answer.messages),
          },
        },
      );
      return;
    }
    // Still processing, or SRI unreachable: ask again later, without an event each time.
    const checks = current.authorizationChecks + 1;
    await update(tx, current, { authorizationChecks: checks });
    await scheduleAuthorization(deps, tx, current, checks);
  });
}

// FR-DOC-5: alert once per document with no final answer 24 hours after RECEIVED: a notification
// to the company, and a log line for the operator.
export async function alertOverdueAuthorizations(deps: SendingDeps): Promise<number> {
  const now = deps.clock.now();
  const cutoff = new Date(now.getTime() - AUTHORIZATION_OVERDUE_AFTER);
  const overdue = await deps.db.withSystem(
    'mark documents with no SRI answer 24 hours after reception',
    async (tx) => {
      const marked = await tx.db
        .update(schema.documents)
        .set({ overdueAlertedAt: now })
        .where(
          sql`${schema.documents.status} = 'RECEIVED' AND ${schema.documents.overdueAlertedAt} IS NULL AND ${schema.documents.receivedAt} < ${cutoff}`,
        )
        .returning({
          id: schema.documents.id,
          tenantId: schema.documents.tenantId,
          accessKey: schema.documents.accessKey,
          series: schema.documents.series,
          sequential: schema.documents.sequential,
        });
      for (const document of marked) await tell(deps.jobs, tx, document, 'DOCUMENT_OVERDUE');
      return marked;
    },
  );
  for (const document of overdue)
    deps.logger.warn('No SRI answer 24 hours after reception', {
      event: 'documents.authorization_overdue',
      tenantId: document.tenantId,
      accessKey: document.accessKey,
    });
  return overdue.length;
}
