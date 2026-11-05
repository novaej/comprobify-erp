import { schema, type Tx } from '@comprobify/db';
import type { CallFacts, SriMessage, SriTransportError } from '../sri';

type Answer = { status: string; messages: SriMessage[]; raw: string } & CallFacts;

// One row per call to SRI, in the transaction that acts on its answer (FR-DOC-13).
export async function recordExchange(
  tx: Tx,
  ref: { tenantId: string; documentId: string },
  operation: 'reception' | 'authorization' | 'validity',
  answer: Answer | SriTransportError,
): Promise<void> {
  const failed = !('status' in answer);
  await tx.db.insert(schema.sriExchanges).values({
    tenantId: ref.tenantId,
    documentId: ref.documentId,
    operation,
    outcome: failed
      ? 'TRANSPORT_ERROR'
      : (answer.status as typeof schema.sriExchanges.$inferInsert.outcome),
    httpStatus: answer.httpStatus,
    messages: failed
      ? []
      : answer.messages.map(({ identifier, message, additionalInfo }) => ({
          identifier,
          message,
          additionalInfo,
        })),
    raw: answer.raw,
    error: failed ? answer.message : null,
    durationMs: answer.durationMs,
  });
}
