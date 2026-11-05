import { and, eq, schema, type Database } from '@comprobify/db';
import { z } from 'zod';
import type { KeyCipher } from '../certificates';
import type { QueuePayload } from '../jobs';
import {
  DomainError,
  ecuadorDate,
  endOfEcuadorDay,
  requirePermission,
  type ActorContext,
} from '../kernel';
import {
  accessKey,
  randomNumericCode,
  redateSignedXml,
  signXml,
  SriTransportError,
  validateXml,
} from '../sri';
import { activeCertificate } from '../tenancy';
import { recordExchange } from './exchanges';
import { applyFinalAnswer, locked, transition, type SendingDeps } from './sending';
import type { Jobs } from '../jobs';

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
    for (const ref of rows)
      await deps.jobs.enqueue(tx, 'sri.reissue', { ...ref, reason: 'AUTO_NEXT_DAY' });
    return rows.length;
  });
}

// FR-DOC-6: from D+2, or a document the automatic run left at a month boundary, a person
// re-issues it after confirming the new date. The worker re-checks SRI first, as always.
export async function requestReissue(
  ctx: ActorContext,
  db: Database,
  documentId: string,
  raw: { issueDate: string },
  deps: { jobs: Pick<Jobs, 'enqueue'> },
): Promise<void> {
  requirePermission(ctx, 'documents.issue');
  const id = z.uuid().parse(documentId);
  const { issueDate } = z.object({ issueDate: z.iso.date() }).parse(raw);
  const today = ecuadorDate(ctx.clock.now());
  // The confirmation named a date that's no longer today: ask again.
  if (issueDate !== today)
    throw new DomainError('REISSUE_DATE_CHANGED', 'The new issue date is no longer today', {
      issueDate: today,
    });
  await db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const row = await locked(tx, { tenantId: ctx.tenantId, documentId: id });
    if (!row) throw new DomainError('NOT_FOUND', 'Document not found');
    if (row.status !== 'SEND_FAILED' || row.issueDate >= today)
      throw new DomainError(
        'NOT_REISSUABLE',
        'Only an unsent document from an earlier day can be re-issued',
      );
    await deps.jobs.enqueue(tx, 'sri.reissue', {
      tenantId: ctx.tenantId,
      documentId: id,
      reason: 'MANUAL',
      issueDate: today,
      actorUserId: ctx.userId ?? null,
    });
  });
}

export async function reissueDocument(
  deps: ReissueDeps,
  job: QueuePayload<'sri.reissue'>,
): Promise<void> {
  const { db, sri, clock, logger } = deps;
  const ref = { tenantId: job.tenantId, documentId: job.documentId };
  const now = clock.now();
  const today = ecuadorDate(now);
  const manual = job.reason === 'MANUAL';
  const row = await db.withTenant({ tenantId: ref.tenantId }, (tx) => locked(tx, ref));
  if (row?.status !== 'SEND_FAILED') return;
  // A person confirmed a date: if it's no longer today, they confirm again.
  if (manual && (job.issueDate !== today || row.issueDate >= today)) {
    logger.warn('Not re-issued: the confirmed date is no longer today', {
      event: 'documents.reissue_date_changed',
      tenantId: row.tenantId,
      accessKey: row.accessKey,
    });
    return;
  }
  // Automatic: only yesterday's; from the day after, it's a person's decision.
  if (!manual && row.issueDate !== yesterdayOf(now)) return;
  if (!manual && row.issueDate.slice(0, 7) !== today.slice(0, 7)) {
    logger.warn('Not re-issued: it would move the document into another month', {
      event: 'documents.reissue_skipped_month',
      tenantId: row.tenantId,
      accessKey: row.accessKey,
    });
    return;
  }

  // SRI may have it after all. A transport error throws, so the job retries later.
  let answer: Awaited<ReturnType<typeof sri.authorization>>;
  try {
    answer = await sri.authorization(row.accessKey, row.ambiente);
  } catch (error) {
    if (error instanceof SriTransportError)
      await db.withTenant({ tenantId: ref.tenantId }, (tx) =>
        recordExchange(tx, ref, 'authorization', error),
      );
    throw error;
  }
  await db.withTenant({ tenantId: ref.tenantId }, (tx) =>
    recordExchange(tx, ref, 'authorization', answer),
  );
  if (answer.status !== 'PENDING') {
    await db.withTenant({ tenantId: ref.tenantId }, async (tx) => {
      const current = await locked(tx, ref);
      if (current?.status === 'SEND_FAILED')
        await applyFinalAnswer(deps.jobs, tx, current, answer, now, 'reissue-check');
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
      reason: job.reason,
      previousAccessKey: current.accessKey,
      previousIssueDate: current.issueDate,
      previousSignedXml: current.signedXml!,
      accessKey: key,
      issueDate: today,
      actorUserId: job.actorUserId ?? null,
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
