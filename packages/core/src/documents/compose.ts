import { and, eq, gte, schema, sql, type Tx } from '@comprobify/db';
import { z } from 'zod';
import type { KeyCipher } from '../certificates';
import type { Jobs } from '../jobs';
import {
  DomainError,
  endOfEcuadorDay,
  limitOf,
  startOfEcuadorMonth,
  toSriAmount,
  type ActorContext,
} from '../kernel';
import { signXml, validateXml, type DocumentTotals, type IssuableType } from '../sri';
import type { AppEnv, IssuingContext } from '../tenancy';

// What the creation of every document type shares: field rules, the quota, the XSD check and
// the signature, the numbers. Each type's own file composes its XML (FR-DOC-2).

// SRI's text fields refuse newlines and tabs (FR-DOC-9); lengths are the XSD's.
export const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\n\r\t]*$/);
export const nameValue = z.object({ name: text(300), value: text(300) });

export type IssueDeps = {
  jobs: Pick<Jobs, 'enqueue'>;
  keyCipher: KeyCipher;
  appEnv: AppEnv;
  // "RUC Proveedor" (ADR-013); null leaves it out.
  providerRuc: string | null;
  // FR-DOC-9: the most a consumidor final invoice may total.
  consumerFinalMaxAmount: string;
};

export type IssuedDocument = {
  id: string;
  number: string;
  sequential: number;
  accessKey: string;
  issueDate: string;
  total: string;
  status: string;
  // False when an idempotent retry returned the existing document.
  created: boolean;
};

// FR-DOC-9: SRI refuses a document over 320 KB.
export const MAX_XML_BYTES = 320 * 1024;
const QUOTA_FEATURE = 'DOCUMENT_QUOTA';

export const lock = (tx: Tx, key: string) =>
  tx.executeSql('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);

export const numberOf = (series: string, sequential: number) =>
  `${series.slice(0, 3)}-${series.slice(3)}-${String(sequential).padStart(9, '0')}`;

export const issued = (
  row: typeof schema.documents.$inferSelect,
  created: boolean,
): IssuedDocument => ({
  id: row.id,
  number: numberOf(row.series, row.sequential),
  sequential: row.sequential,
  accessKey: row.accessKey,
  issueDate: row.issueDate,
  total: row.total,
  status: row.status,
  created,
});

// Until billing periods exist (Milestone 8) a quota counts the Ecuador calendar month.
// The twin and a company still in test never use quota (FR-ONB-6a, FR-BILL-7).
export async function consumeQuota(ctx: ActorContext, tx: Tx) {
  if (ctx.tenantMode !== 'PRODUCTION') return;
  const limit = limitOf(ctx.entitlements, QUOTA_FEATURE);
  if (limit === null) return;
  await lock(tx, `quota:${ctx.tenantId}`);
  const [row] = await tx.db
    .select({ used: sql<number>`count(*)::int` })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.tenantId, ctx.tenantId),
        gte(schema.documents.createdAt, startOfEcuadorMonth(ctx.clock.now())),
      ),
    );
  if (row!.used >= limit)
    throw new DomainError('QUOTA_EXCEEDED', 'The document quota for this period is used up', {
      limit,
    });
}

// SRI rule 8: never sign what the XSD refuses. Then the size SRI accepts (FR-DOC-9).
export async function validateAndSign(
  ctx: ActorContext,
  xml: string,
  documentType: IssuableType,
  issuer: IssuingContext,
  deps: Pick<IssueDeps, 'keyCipher'>,
): Promise<string> {
  const check = await validateXml(xml, documentType);
  if (!check.valid)
    throw new DomainError('XML_INVALID', 'The document does not match the SRI schema', {
      errors: check.errors,
    });
  const signedXml = signXml(
    xml,
    {
      privateKeyPem: deps.keyCipher.decrypt(issuer.certificate.encryptedPrivateKey),
      certificatePem: issuer.certificate.certificatePem,
    },
    ctx.clock.now(),
  );
  if (Buffer.byteLength(signedXml, 'utf8') > MAX_XML_BYTES)
    throw new DomainError('DOCUMENT_TOO_LARGE', 'The document is larger than SRI accepts');
  return signedXml;
}

// The totals as the document stores them: the same rounding the XML used (ADR-012).
export const totalsColumns = (totals: DocumentTotals) => ({
  subtotal: toSriAmount(totals.subtotal),
  discount: toSriAmount(totals.discount),
  taxTotals: totals.taxes.map((tax) => ({
    taxCode: tax.taxCode,
    rateCode: tax.rateCode,
    percent: tax.percent.toString(),
    base: toSriAmount(tax.base),
    value: toSriAmount(tax.value),
  })),
  total: toSriAmount(totals.total),
});

export const retryDeadline = (issueDate: string) => endOfEcuadorDay(issueDate);

// FR-DOC-2 step 1: the same key and payload return the same document; the same key with another
// payload is a conflict. Two requests with one key wait for each other here, so one creates.
// The document a key already made, whatever it said: for a caller whose content depends on
// state the first try changed, such as what an order has left (ADR-026).
export async function findIssuedByKey(
  tx: Tx,
  ctx: ActorContext,
  key: string,
): Promise<IssuedDocument | null> {
  await lock(tx, `idempotency:${ctx.tenantId}:${key}`);
  const [existing] = await tx.db
    .select()
    .from(schema.documents)
    .where(
      and(eq(schema.documents.tenantId, ctx.tenantId), eq(schema.documents.idempotencyKey, key)),
    );
  return existing ? issued(existing, false) : null;
}

export async function findIdempotent(
  tx: Tx,
  ctx: ActorContext,
  key: string | null,
  payloadHash: string,
): Promise<IssuedDocument | null> {
  if (!key) return null;
  await lock(tx, `idempotency:${ctx.tenantId}:${key}`);
  const [existing] = await tx.db
    .select()
    .from(schema.documents)
    .where(
      and(eq(schema.documents.tenantId, ctx.tenantId), eq(schema.documents.idempotencyKey, key)),
    );
  if (!existing) return null;
  if (existing.payloadHash !== payloadHash)
    throw new DomainError(
      'IDEMPOTENCY_CONFLICT',
      'This idempotency key was used for a different document',
    );
  return issued(existing, false);
}
