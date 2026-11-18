import { createHash } from 'node:crypto';
import { and, eq, inArray, schema, type Database } from '@comprobify/db';
import forge from 'node-forge';
import { legacyExportInput, type LegacyExport } from './input';

// ADR-049, PRD section 15 (Milestone 10 gate): the migrated copy reconciles with what was
// exported: counts, the sequentials and each document's XML, read back from the database.

export type ReconciliationCheck = {
  check: string;
  expected: string;
  actual: string;
  ok: boolean;
};
export type Reconciliation = { ok: boolean; checks: ReconciliationCheck[] };

const sha256 = (value: string | null | undefined) =>
  value ? createHash('sha256').update(value, 'utf8').digest('hex') : '(none)';

const certificateFingerprint = (pem: string) =>
  forge.md.sha256
    .create()
    .update(
      forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(pem))).getBytes(),
    )
    .digest()
    .toHex();

export async function reconcileLegacyImport(
  db: Database,
  raw: LegacyExport,
  imported: { realTenantId: string; accounts: { email: string }[] },
): Promise<Reconciliation> {
  const data = legacyExportInput.parse(raw);
  const checks: ReconciliationCheck[] = [];
  const add = (check: string, expected: unknown, actual: unknown) =>
    checks.push({
      check,
      expected: String(expected),
      actual: String(actual),
      ok: String(expected) === String(actual),
    });

  await db.withTenant({ tenantId: imported.realTenantId }, async ({ db: tx }) => {
    const { documents, documentSequences, issuePoints, branches, certificates } = schema;
    const rows = await tx
      .select({
        accessKey: documents.accessKey,
        status: documents.status,
        total: documents.total,
        signedXml: documents.signedXml,
        authorizationXml: documents.authorizationXml,
        authorizationNumber: documents.authorizationNumber,
      })
      .from(documents)
      .where(eq(documents.tenantId, imported.realTenantId));
    const byKey = new Map(rows.map((row) => [row.accessKey, row]));

    add('documents', data.documents.length, rows.length);
    for (const status of ['AUTHORIZED', 'VOIDED'])
      add(
        `documents ${status}`,
        data.documents.filter((doc) => doc.status === status).length,
        rows.filter((row) => row.status === status).length,
      );
    const cents = (values: string[]) =>
      values.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0) / 100;
    const xmlTotal = (xml: string | null) => /<importeTotal>([^<]+)</.exec(xml ?? '')?.[1] ?? '0';
    add(
      'documents total',
      cents(data.documents.map((doc) => xmlTotal(doc.authorizationXml ?? doc.signedXml))).toFixed(
        2,
      ),
      cents(rows.map((row) => row.total)).toFixed(2),
    );
    for (const doc of data.documents) {
      const row = byKey.get(doc.accessKey);
      add(`${doc.accessKey} found`, true, !!row);
      add(`${doc.accessKey} signed XML sha256`, sha256(doc.signedXml), sha256(row?.signedXml));
      add(
        `${doc.accessKey} authorized XML sha256`,
        sha256(doc.authorizationXml ?? doc.signedXml),
        sha256(row?.authorizationXml),
      );
      add(
        `${doc.accessKey} authorization number`,
        doc.authorizationNumber,
        row?.authorizationNumber ?? '(none)',
      );
    }

    const sequences = await tx
      .select({
        branch: branches.code,
        point: issuePoints.code,
        type: documentSequences.documentType,
        next: documentSequences.nextValue,
      })
      .from(documentSequences)
      .innerJoin(issuePoints, eq(issuePoints.id, documentSequences.issuePointId))
      .innerJoin(branches, eq(branches.id, issuePoints.branchId))
      .where(eq(documentSequences.tenantId, imported.realTenantId));
    for (const old of data.sequentials.filter((one) => one.currentValue > 0)) {
      const now = sequences.find(
        (one) =>
          one.branch === old.branchCode &&
          one.point === old.issuePointCode &&
          one.type === old.documentType,
      );
      add(
        `last sequential ${old.branchCode}-${old.issuePointCode} type ${old.documentType}`,
        old.currentValue,
        now ? now.next - 1 : '(none)',
      );
    }

    const issuer = data.issuers.find((one) => one.active && one.certificatePem);
    const [certificate] = await tx
      .select({ fingerprint: certificates.fingerprint })
      .from(certificates)
      .where(and(eq(certificates.tenantId, imported.realTenantId), eq(certificates.active, true)));
    add(
      'certificate fingerprint',
      issuer?.certificatePem ? certificateFingerprint(issuer.certificatePem) : '(none)',
      certificate?.fingerprint ?? '(none)',
    );

    const count = async (table: typeof schema.clients | typeof schema.products) =>
      (
        await tx
          .select({ id: table.id })
          .from(table)
          .where(eq(table.tenantId, imported.realTenantId))
      ).length;
    // Clients also come from the documents' buyers, so at least the saved ones.
    const clients = await count(schema.clients);
    add('clients (at least the saved ones)', true, clients >= data.clients.length);
    add('products', data.products.length, await count(schema.products));
    const templates = await tx
      .select({ id: schema.documentTemplates.id })
      .from(schema.documentTemplates)
      .where(eq(schema.documentTemplates.tenantId, imported.realTenantId));
    add('templates', data.templates.length, templates.length);
  });

  const emails = imported.accounts.map((account) => account.email);
  const found =
    emails.length > 0
      ? await db.identity
          .select({ email: schema.users.email })
          .from(schema.users)
          .where(inArray(schema.users.email, emails))
      : [];
  add('accounts', emails.length, found.length);

  return { ok: checks.every((check) => check.ok), checks };
}
