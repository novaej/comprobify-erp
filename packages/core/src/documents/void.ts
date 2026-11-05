import { eq, schema, type Database } from '@comprobify/db';
import { z } from 'zod';
import { DomainError, requireFeature, requirePermission, type ActorContext } from '../kernel';
import {
  CONSUMER_FINAL_ID,
  SriTransportError,
  type CallFacts,
  type SriClient,
  type ValidityResult,
} from '../sri';
import { recordExchange } from './exchanges';
import { locked, transition } from './sending';

// FR-DOC-8: SRI has no service to void; the company voids on SRI's portal, and the
// document is marked VOIDED here once Consulta de validez says so.

// The 7th of the month after the issue date (verify the resolution's text, PRD 17 q4).
export function voidDeadline(issueDate: string): string {
  const [year, month] = issueDate.split('-').map(Number) as [number, number];
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return `${next.year}-${String(next.month).padStart(2, '0')}-07`;
}

export const voidInput = z.object({
  // When SRI's service is down: the user states the document was voided on the portal.
  attestedVoidedAtSri: z.boolean().default(false),
});
export type VoidInput = z.input<typeof voidInput>;

export async function voidDocument(
  ctx: ActorContext,
  db: Database,
  documentId: string,
  raw: VoidInput,
  deps: { sri: Pick<SriClient, 'validity'> },
): Promise<{ status: 'VOIDED'; attested: boolean }> {
  requirePermission(ctx, 'documents.void');
  requireFeature(ctx, 'DOCUMENT_VOID');
  const id = z.uuid().parse(documentId);
  const input = voidInput.parse(raw);

  const [row] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx.select().from(schema.documents).where(eq(schema.documents.id, id)),
  );
  if (!row) throw new DomainError('NOT_FOUND', 'Document not found');
  if (row.status !== 'AUTHORIZED')
    throw new DomainError('NOT_VOIDABLE', 'Only an authorized document can be voided', {
      status: row.status,
    });
  // A consumidor final invoice can't be voided (PRD section 6, rule 10).
  if (row.buyerIdentification === CONSUMER_FINAL_ID)
    throw new DomainError('VOID_CONSUMER_FINAL', 'A consumidor final invoice can not be voided');

  let validity: (ValidityResult & CallFacts) | null;
  try {
    validity = await deps.sri.validity(row.accessKey, row.ambiente);
  } catch (error) {
    if (!(error instanceof SriTransportError)) throw error;
    await db.withTenant({ tenantId: ctx.tenantId }, (tx) =>
      recordExchange(tx, { tenantId: ctx.tenantId, documentId: id }, 'validity', error),
    );
    validity = null;
  }
  if (validity) {
    const answer = validity;
    await db.withTenant({ tenantId: ctx.tenantId }, (tx) =>
      recordExchange(tx, { tenantId: ctx.tenantId, documentId: id }, 'validity', answer),
    );
  }
  const deadline = voidDeadline(row.issueDate);
  // SRI only checks recent documents; older ones it can't confirm either way (Ficha 8.2.3).
  const outOfRange =
    validity?.status === 'NOT_FOUND' &&
    validity.messages.some(
      (message) =>
        message.identifier === '99' && /fuera del rango/i.test(message.additionalInfo ?? ''),
    );
  if (outOfRange) validity = null;
  if (validity === null && !input.attestedVoidedAtSri)
    throw new DomainError('SRI_UNAVAILABLE', 'SRI can not confirm the void right now', {
      canAttest: true,
      deadline,
      reason: outOfRange ? 'OUT_OF_RANGE' : 'UNREACHABLE',
    });
  if (validity && validity.status !== 'VOIDED' && validity.status !== 'PENDING_VOID')
    throw new DomainError('NOT_VOIDED_AT_SRI', 'SRI does not show this document as voided', {
      sriStatus: validity.status,
      deadline,
    });

  await db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const current = await locked(tx, { tenantId: ctx.tenantId, documentId: id });
    if (current?.status !== 'AUTHORIZED')
      throw new DomainError('NOT_VOIDABLE', 'Only an authorized document can be voided');
    await transition(
      tx,
      current,
      'VOIDED',
      {},
      {
        type: 'VOIDED',
        details: validity
          ? { sriStatus: validity.status, source: validity.source }
          : {
              attested: true,
              reason: outOfRange ? 'outside the dates SRI checks' : 'SRI unavailable',
            },
        actorUserId: ctx.userId ?? null,
      },
    );
  });
  return { status: 'VOIDED', attested: validity === null };
}
