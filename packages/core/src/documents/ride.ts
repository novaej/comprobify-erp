import { and, eq, schema, type Database } from '@comprobify/db';
import { z } from 'zod';
import type { EmailProvider } from '../email';
import { renderDocumentEmail } from '../email';
import { loadEntitlements } from '../entitlements';
import {
  DomainError,
  requireFeature,
  requirePermission,
  type ActorContext,
  type Clock,
} from '../kernel';
import { authorizedXmlFile, renderRide, rideData } from '../sri';
import { companyLogo, documentLogo } from '../tenancy';
import type { Jobs, QueuePayload } from '../jobs';
import type { Logger } from '@comprobify/config/logger';
import type { Row } from './sending';

// FR-DOC-10 and FR-DOC-11. Both files come from the XML SRI authorized, never from live
// data; only the logo is current.

const RIDE_STATUSES = ['AUTHORIZED', 'VOIDED'];

const number = (row: Row) =>
  `${row.series.slice(0, 3)}-${row.series.slice(3)}-${String(row.sequential).padStart(9, '0')}`;

async function files(row: Row, logo: Buffer | null) {
  if (!row.authorizationXml || !row.authorizationNumber || !row.authorizedAt)
    throw new Error('An authorized document without its authorization');
  const data = rideData(row.authorizationXml);
  const pdf = await renderRide(data, {
    authorizationNumber: row.authorizationNumber,
    authorizedAt: row.authorizedAt,
    logo,
  });
  const xml = authorizedXmlFile({
    comprobante: row.authorizationXml,
    authorizationNumber: row.authorizationNumber,
    authorizedAt: row.authorizedAt,
    ambiente: row.ambiente,
  });
  return { data, pdf, xml, name: `${number(row)}` };
}

// The RIDE for viewing or download.
export async function documentRide(
  ctx: ActorContext,
  db: Database,
  documentId: string,
): Promise<{ filename: string; content: Buffer }> {
  requirePermission(ctx, 'documents.read');
  const id = z.uuid().parse(documentId);
  const [row] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx.select().from(schema.documents).where(eq(schema.documents.id, id)),
  );
  if (!row) throw new DomainError('NOT_FOUND', 'Document not found');
  if (!RIDE_STATUSES.includes(row.status))
    throw new DomainError('NOT_AUTHORIZED', 'A RIDE exists only once SRI authorizes the document');
  const logo = await companyLogo(ctx, db);
  const { pdf, name } = await files(row, logo?.content ?? null);
  return { filename: `RIDE ${name}.pdf`, content: pdf };
}

export type DocumentEmailDeps = {
  db: Database;
  provider: EmailProvider;
  clock: Clock;
  logger: Logger;
};

// The job: once per authorization unless resent, only with BUYER_EMAIL and a buyer email.
// A retry after a send whose event didn't commit sends twice, which is harmless.
export async function emailDocument(
  deps: DocumentEmailDeps,
  job: QueuePayload<'documents.email'>,
): Promise<void> {
  const { db, provider, clock, logger } = deps;
  const prepared = await db.withTenant({ tenantId: job.tenantId }, async (tx) => {
    const [row] = await tx.db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, job.documentId));
    if (row?.status !== 'AUTHORIZED' || !row.buyerEmail) return null;
    const entitlements = await loadEntitlements(tx.db, job.tenantId, clock.now());
    if (!entitlements.features.includes('BUYER_EMAIL')) return null;
    if (!job.resend) {
      const [emailed] = await tx.db
        .select({ id: schema.documentEvents.id })
        .from(schema.documentEvents)
        .where(
          and(
            eq(schema.documentEvents.documentId, row.id),
            eq(schema.documentEvents.type, 'EMAILED'),
          ),
        )
        .limit(1);
      if (emailed) return null;
    }
    return { row, logo: await documentLogo(tx, job.tenantId, entitlements.features) };
  });
  if (!prepared) return;
  const { row, logo } = prepared;

  const { data, pdf, xml, name } = await files(row, logo);
  const message = renderDocumentEmail(row.buyerEmail!, {
    organization: data.legalName,
    documentLabel: 'Factura',
    number: name,
    issueDate: data.issueDate,
    total: data.total,
    test: row.ambiente !== '2',
  });
  const result = await provider.send({
    ...message,
    attachments: [
      { filename: `RIDE ${name}.pdf`, content: pdf, contentType: 'application/pdf' },
      {
        filename: `${row.accessKey}.xml`,
        content: Buffer.from(xml, 'utf8'),
        contentType: 'application/xml',
      },
    ],
    variables: { 'document-id': row.id, 'tenant-id': row.tenantId },
  });

  // EMAIL_PROVIDER=none: nothing went out, so the timeline says nothing.
  if (result === 'skipped') {
    logger.info("The buyer's copy was not sent: email is off", {
      event: 'documents.email_skipped',
      tenantId: row.tenantId,
      accessKey: row.accessKey,
    });
    return;
  }
  await db.withTenant({ tenantId: job.tenantId }, ({ db: tx }) =>
    tx.insert(schema.documentEvents).values({
      tenantId: row.tenantId,
      documentId: row.id,
      type: 'EMAILED',
      details: {
        to: row.buyerEmail,
        resend: job.resend,
        // Written to the log, not sent: local only.
        ...(result === 'logged' ? { logged: true } : {}),
      },
    }),
  );
  logger.info('Sent the document to the buyer', {
    event: 'documents.emailed',
    tenantId: row.tenantId,
    accessKey: row.accessKey,
  });
}

// FR-DOC-11: a person sends it again, say after the buyer lost it.
export async function resendDocumentEmail(
  ctx: ActorContext,
  db: Database,
  documentId: string,
  deps: { jobs: Pick<Jobs, 'enqueue'> },
): Promise<void> {
  requirePermission(ctx, 'documents.issue');
  requireFeature(ctx, 'BUYER_EMAIL');
  const id = z.uuid().parse(documentId);
  await db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx.db.select().from(schema.documents).where(eq(schema.documents.id, id));
    if (!row) throw new DomainError('NOT_FOUND', 'Document not found');
    if (row.status !== 'AUTHORIZED')
      throw new DomainError('NOT_AUTHORIZED', 'Only an authorized document is sent to the buyer');
    if (!row.buyerEmail)
      throw new DomainError('NO_BUYER_EMAIL', 'The buyer has no email on this document');
    await deps.jobs.enqueue(tx, 'documents.email', {
      tenantId: ctx.tenantId,
      documentId: id,
      resend: true,
    });
  });
}
