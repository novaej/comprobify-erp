import type { Logger } from '@comprobify/config/logger';
import { and, eq, schema, sql, type Database, type Tx } from '@comprobify/db';
import type { Jobs } from '../jobs';
import { endOfEcuadorDay, type Clock } from '../kernel';
import { SRI_SEQUENTIAL_TAKEN, SriTransportError, type SriClient, type SriMessage } from '../sri';
import { AUTHORIZATION_OVERDUE_AFTER, nextAuthorizationCheck, nextSendAttempt } from './calendar';
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
    type?: 'STATUS_CHANGED' | 'REISSUED';
    details?: Record<string, unknown>;
    sriResponse?: string;
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
    sriResponse: event.sriResponse ?? null,
    actorUserId: event.actorUserId ?? null,
  });
  return updated!;
}

async function update(tx: Tx, row: Row, changes: Changes): Promise<void> {
  await tx.db.update(schema.documents).set(changes).where(eq(schema.documents.id, row.id));
}

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
async function toReceived(
  tx: Tx,
  row: Row,
  now: Date,
  details: Record<string, unknown>,
  raw: string,
) {
  let current = row;
  if (current.status === 'SIGNED') current = await transition(tx, current, 'PENDING_SEND');
  return transition(tx, current, 'RECEIVED', { receivedAt: now }, { details, sriResponse: raw });
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
    const details = { operation: 'reception', messages: summary(outcome.messages) };
    if (outcome.status === 'RECEIVED') {
      const received = await toReceived(tx, row, now, details, outcome.raw);
      await scheduleAuthorization(deps, tx, received, 0);
      return;
    }
    const taken = outcome.messages.some((message) => message.identifier === SRI_SEQUENTIAL_TAKEN);
    await transition(
      tx,
      row,
      'RETURNED',
      {},
      {
        details: { ...details, sequentialTaken: taken },
        sriResponse: outcome.raw,
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
  tx: Tx,
  row: Row,
  answer: Exclude<AuthorizationAnswer, { status: 'PENDING' }>,
  now: Date,
  operation: string,
): Promise<Row> {
  const details = { operation, messages: summary(answer.messages) };
  const received = await toReceived(tx, row, now, details, answer.raw);
  if (answer.status === 'AUTHORIZED')
    return transition(
      tx,
      received,
      'AUTHORIZED',
      {
        authorizationNumber: answer.authorizationNumber,
        authorizedAt: answer.authorizedAt,
        authorizationXml: answer.authorizationXml,
      },
      { details, sriResponse: answer.raw },
    );
  return transition(tx, received, 'NOT_AUTHORIZED', {}, { details, sriResponse: answer.raw });
}

// FR-DOC-4: once the issue day is over, one read-only question to SRI.
export async function checkAfterDeadline(deps: SendingDeps, ref: DocumentRef): Promise<void> {
  const { db, sri, clock } = deps;
  const now = clock.now();
  const row = await db.withTenant({ tenantId: ref.tenantId }, (tx) => locked(tx, ref));
  if (!row || !SENDABLE.includes(row.status) || row.deadlineCheckedAt) return;

  let answer: Awaited<ReturnType<SriClient['authorization']>> | null;
  try {
    answer = await sri.authorization(row.accessKey, row.ambiente);
  } catch (error) {
    if (!(error instanceof SriTransportError)) throw error;
    answer = null;
  }

  await db.withTenant({ tenantId: ref.tenantId }, async (tx) => {
    let current = await locked(tx, ref);
    if (!current || !SENDABLE.includes(current.status) || current.deadlineCheckedAt) return;
    const checked = { deadlineCheckedAt: now, sriUnreachable: answer === null };
    if (answer && answer.status !== 'PENDING') {
      current = await applyFinalAnswer(tx, current, answer, now, 'deadline-check');
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
          details: { operation: 'deadline-check', sriUnreachable: answer === null },
        },
      );
    await update(tx, current, checked);
  });
}

export async function checkAuthorization(deps: SendingDeps, ref: DocumentRef): Promise<void> {
  const { db, sri } = deps;
  const row = await db.withTenant({ tenantId: ref.tenantId }, (tx) => locked(tx, ref));
  if (row?.status !== 'RECEIVED') return;

  let answer: Awaited<ReturnType<SriClient['authorization']>> | null;
  try {
    answer = await sri.authorization(row.accessKey, row.ambiente);
  } catch (error) {
    if (!(error instanceof SriTransportError)) throw error;
    answer = null;
  }

  await db.withTenant({ tenantId: ref.tenantId }, async (tx) => {
    const current = await locked(tx, ref);
    if (current?.status !== 'RECEIVED') return;
    if (answer?.status === 'AUTHORIZED') {
      await transition(
        tx,
        current,
        'AUTHORIZED',
        {
          authorizationNumber: answer.authorizationNumber,
          authorizedAt: answer.authorizedAt,
          authorizationXml: answer.authorizationXml,
        },
        {
          details: { operation: 'authorization', messages: summary(answer.messages) },
          sriResponse: answer.raw,
        },
      );
      return;
    }
    if (answer?.status === 'NOT_AUTHORIZED') {
      await transition(
        tx,
        current,
        'NOT_AUTHORIZED',
        {},
        {
          details: { operation: 'authorization', messages: summary(answer.messages) },
          sriResponse: answer.raw,
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

// FR-DOC-5: alert once per document with no final answer 24 hours after RECEIVED. The
// in-app notification comes with notifications (Milestone 9); today it is logged.
export async function alertOverdueAuthorizations(deps: SendingDeps): Promise<number> {
  const now = deps.clock.now();
  const cutoff = new Date(now.getTime() - AUTHORIZATION_OVERDUE_AFTER);
  const overdue = await deps.db.withSystem(
    'mark documents with no SRI answer 24 hours after reception',
    ({ db: tx }) =>
      tx
        .update(schema.documents)
        .set({ overdueAlertedAt: now })
        .where(
          sql`${schema.documents.status} = 'RECEIVED' AND ${schema.documents.overdueAlertedAt} IS NULL AND ${schema.documents.receivedAt} < ${cutoff}`,
        )
        .returning({ tenantId: schema.documents.tenantId, accessKey: schema.documents.accessKey }),
  );
  for (const document of overdue)
    deps.logger.warn('No SRI answer 24 hours after reception', {
      event: 'documents.authorization_overdue',
      tenantId: document.tenantId,
      accessKey: document.accessKey,
    });
  return overdue.length;
}
