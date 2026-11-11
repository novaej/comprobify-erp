import type { Logger } from '@comprobify/config/logger';
import { asc, desc, eq, schema, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { addDays, ecuadorDate, RETENTION, startOfEcuadorDay, type Clock } from '../kernel';
import { documentNumber } from './queries';

// FR-DOC-13: what SRI answered to each call, for support, and the retention of its raw copy.

// The raw copies older than the retention period, cleared in the database: the row (the call, its
// outcome and the messages) stays for the tax period, the technical duplicate goes. A clear and
// nothing else: the database lets the app role change no other column, and only to null. In
// batches, so one night's work never holds a long lock. Safe to run again (NFR-JOB-1).
export const PRUNE_BATCH = 5000;

export async function pruneSriRaw(deps: {
  db: Database;
  clock: Clock;
  logger: Logger;
}): Promise<number> {
  const cutoff = startOfEcuadorDay(addDays(ecuadorDate(deps.clock.now()), -RETENTION.sriRawDays));
  let cleared = 0;
  for (;;) {
    const batch = await deps.db.withSystem(
      'clear the raw SRI answers past their retention',
      async (tx) => {
        const { rows } = await tx.executeSql<{ id: string }>(
          `UPDATE sri_exchanges SET raw = NULL
           WHERE id IN (
             SELECT id FROM sri_exchanges WHERE raw IS NOT NULL AND occurred_at < $1
             ORDER BY occurred_at LIMIT $2)
           RETURNING id`,
          [cutoff, PRUNE_BATCH],
        );
        return rows.length;
      },
    );
    cleared += batch;
    if (batch < PRUNE_BATCH) break;
  }
  if (cleared > 0)
    deps.logger.info(`Cleared ${cleared} raw SRI answers older than ${RETENTION.sriRawDays} days`, {
      event: 'retention.sri_raw_cleared',
    });
  return cleared;
}

export type SupportExchange = {
  id: string;
  operation: string;
  outcome: string;
  source: string | null;
  host: string | null;
  httpStatus: number | null;
  messages: { identifier: string; message: string; additionalInfo: string | null }[];
  error: string | null;
  durationMs: number;
  occurredAt: Date;
  // What SRI answered, until its retention passes; then null and `rawCleared` says so.
  raw: string | null;
};

export type SupportDocument = {
  id: string;
  tenantId: string;
  documentType: string;
  number: string;
  status: string;
  issueDate: string;
  accessKey: string;
  exchanges: SupportExchange[];
};

const accessKeyInput = z.string().regex(/^\d{49}$/);

// A document by its access key, current or from before a re-issue, with every call made to SRI
// for it, oldest first. In the caller's system-context transaction, across companies.
export async function documentForSupport(
  tx: Tx['db'],
  key: string,
): Promise<SupportDocument | null> {
  const accessKey = accessKeyInput.parse(key);
  const { documents, documentReissues, sriExchanges } = schema;
  const columns = {
    id: documents.id,
    tenantId: documents.tenantId,
    documentType: documents.documentType,
    series: documents.series,
    sequential: documents.sequential,
    status: documents.status,
    issueDate: documents.issueDate,
    accessKey: documents.accessKey,
  };
  let [document] = await tx
    .select(columns)
    .from(documents)
    .where(eq(documents.accessKey, accessKey));
  if (!document) {
    const [previous] = await tx
      .select({ documentId: documentReissues.documentId })
      .from(documentReissues)
      .where(eq(documentReissues.previousAccessKey, accessKey));
    if (previous)
      [document] = await tx
        .select(columns)
        .from(documents)
        .where(eq(documents.id, previous.documentId));
  }
  if (!document) return null;
  const exchanges = await tx
    .select({
      id: sriExchanges.id,
      operation: sriExchanges.operation,
      outcome: sriExchanges.outcome,
      source: sriExchanges.source,
      host: sriExchanges.host,
      httpStatus: sriExchanges.httpStatus,
      messages: sriExchanges.messages,
      error: sriExchanges.error,
      durationMs: sriExchanges.durationMs,
      occurredAt: sriExchanges.occurredAt,
      raw: sriExchanges.raw,
    })
    .from(sriExchanges)
    .where(eq(sriExchanges.documentId, document.id))
    .orderBy(asc(sriExchanges.occurredAt), desc(sriExchanges.id));
  return {
    id: document.id,
    tenantId: document.tenantId,
    documentType: document.documentType,
    number: documentNumber(document.series, document.sequential),
    status: document.status,
    issueDate: document.issueDate,
    accessKey: document.accessKey,
    exchanges,
  };
}
