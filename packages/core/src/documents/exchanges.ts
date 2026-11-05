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
    source: answer.source,
    host: answer.host,
  });
}

// FR-DOC-7: each signed version, so a correction never loses what was sent before.
export async function recordVersion(
  tx: Tx,
  version: {
    tenantId: string;
    documentId: string;
    reason: 'CREATED' | 'CORRECTED' | 'REISSUED';
    revision: number;
    accessKey: string;
    issueDate: string;
    signedXml: string;
    actorUserId: string | null;
  },
): Promise<void> {
  await tx.db.insert(schema.documentVersions).values(version);
}
