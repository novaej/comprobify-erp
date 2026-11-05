import { and, eq, schema } from '@comprobify/db';
import type { KeyCipher } from '../certificates';
import { ecuadorDate, endOfEcuadorDay } from '../kernel';
import { accessKey, randomNumericCode, redateSignedXml, signXml, validateXml } from '../sri';
import { activeCertificate } from '../tenancy';
import {
  applyFinalAnswer,
  locked,
  transition,
  type DocumentRef,
  type SendingDeps,
} from './sending';

// FR-DOC-6: on the day after, each document SRI never got is re-checked and, if SRI still
// lacks it, re-issued: today's date, a new key, the same sequential. The old key, date and
// XML go to document_reissues. A month boundary is never crossed automatically.

export type ReissueDeps = SendingDeps & { keyCipher: KeyCipher };

const DAY = 86_400_000;
const yesterdayOf = (now: Date) => ecuadorDate(new Date(now.getTime() - DAY));

// The daily sweep: one job per document, so one failure doesn't hold up the rest.
export async function enqueueReissues(deps: SendingDeps): Promise<number> {
  const yesterday = yesterdayOf(deps.clock.now());
  return deps.db.withSystem('find yesterday’s documents SRI never received', async (tx) => {
    const rows = await tx.db
      .select({ tenantId: schema.documents.tenantId, documentId: schema.documents.id })
      .from(schema.documents)
      .where(
        and(eq(schema.documents.status, 'SEND_FAILED'), eq(schema.documents.issueDate, yesterday)),
      );
    for (const ref of rows) await deps.jobs.enqueue(tx, 'sri.reissue', ref);
    return rows.length;
  });
}

export async function reissueDocument(deps: ReissueDeps, ref: DocumentRef): Promise<void> {
  const { db, sri, clock, logger } = deps;
  const now = clock.now();
  const today = ecuadorDate(now);
  const row = await db.withTenant({ tenantId: ref.tenantId }, (tx) => locked(tx, ref));
  // Only yesterday's: from the day after, re-issuing is a person's decision.
  if (row?.status !== 'SEND_FAILED' || row.issueDate !== yesterdayOf(now)) return;
  if (row.issueDate.slice(0, 7) !== today.slice(0, 7)) {
    logger.warn('Not re-issued: it would move the document into another month', {
      event: 'documents.reissue_skipped_month',
      tenantId: row.tenantId,
      accessKey: row.accessKey,
    });
    return;
  }

  // SRI may have it after all. A transport error throws, so the job retries later.
  const answer = await sri.authorization(row.accessKey, row.ambiente);
  if (answer.status !== 'PENDING') {
    await db.withTenant({ tenantId: ref.tenantId }, async (tx) => {
      const current = await locked(tx, ref);
      if (current?.status === 'SEND_FAILED')
        await applyFinalAnswer(tx, current, answer, now, 'reissue-check');
    });
    return;
  }

  const certificate = await db.withTenant({ tenantId: ref.tenantId }, (tx) =>
    activeCertificate(tx, ref.tenantId),
  );
  const key = accessKey({
    issueDate: today,
    documentType: row.documentType,
    ruc: certificate.ruc,
    ambiente: row.ambiente,
    series: row.series,
    sequential: row.sequential,
    numericCode: randomNumericCode(),
  });
  const xml = redateSignedXml(row.signedXml!, { accessKey: key, issueDate: today });
  // SRI rule 8, as at creation.
  const check = await validateXml(xml, '01');
  if (!check.valid) throw new Error(`Re-issued XML fails the XSD: ${check.errors.join('; ')}`);
  const signedXml = signXml(
    xml,
    {
      privateKeyPem: deps.keyCipher.decrypt(certificate.encryptedPrivateKey),
      certificatePem: certificate.certificatePem,
    },
    now,
  );

  await db.withTenant({ tenantId: ref.tenantId }, async (tx) => {
    const current = await locked(tx, ref);
    if (current?.status !== 'SEND_FAILED' || current.accessKey !== row.accessKey) return;
    await tx.db.insert(schema.documentReissues).values({
      tenantId: current.tenantId,
      documentId: current.id,
      reason: 'AUTO_NEXT_DAY',
      previousAccessKey: current.accessKey,
      previousIssueDate: current.issueDate,
      previousSignedXml: current.signedXml!,
      accessKey: key,
      issueDate: today,
    });
    await transition(
      tx,
      current,
      'SIGNED',
      {
        accessKey: key,
        issueDate: today,
        signedXml,
        retryUntil: endOfEcuadorDay(today),
        sendAttempts: 0,
        deadlineCheckedAt: null,
        sriUnreachable: false,
      },
      {
        type: 'REISSUED',
        details: {
          reason: 'AUTO_NEXT_DAY',
          previousAccessKey: current.accessKey,
          issueDate: today,
        },
      },
    );
    await deps.jobs.enqueue(tx, 'sri.send', ref);
  });
  logger.info('Re-issued with today’s date', {
    event: 'documents.reissued',
    tenantId: row.tenantId,
    accessKey: key,
  });
}
