import { and, eq, schema, sql, type Tx } from '@comprobify/db';
import { DomainError } from '../kernel';

// SRI rule 9: the next sequential, inside the transaction that creates the document. The
// row lock makes two documents created at once wait for each other instead of sharing a
// number; a rolled-back document gives its number back.
export async function takeSequential(
  tx: Tx['db'],
  input: { tenantId: string; issuePointId: string; documentType: string },
): Promise<number> {
  const { documentSequences } = schema;
  const where = and(
    eq(documentSequences.tenantId, input.tenantId),
    eq(documentSequences.issuePointId, input.issuePointId),
    eq(documentSequences.documentType, input.documentType as '01'),
  );
  const [row] = await tx
    .select({ id: documentSequences.id, next: documentSequences.nextValue })
    .from(documentSequences)
    .where(where)
    .for('update');
  if (!row)
    throw new DomainError('DOCUMENT_TYPE_NOT_ENABLED', 'This issue point does not issue that type');
  if (row.next >= 999_999_999)
    throw new DomainError('SEQUENCE_EXHAUSTED', 'This issue point has used every number');
  await tx
    .update(documentSequences)
    .set({ nextValue: row.next + 1, updatedAt: sql`now()` })
    .where(eq(documentSequences.id, row.id));
  return row.next;
}
