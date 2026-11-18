// Operator only (ADR-049): bring one company from restored copies of the previous system's two
// databases into this one, then reconcile. A dry run unless --commit, and even then nothing is
// kept when a check fails. docs/guides/legacy-import.md is the procedure.
// Usage: pnpm import:legacy --ruc <ruc> --super-admin <email> [--leave-out <email>]...
//          [--plan ENTERPRISE] [--leave-unpaid] [--commit]
import { parseArgs } from 'node:util';
import { loadLegacyImportEnv } from '@comprobify/config/env';
import { createLogger } from '@comprobify/config/logger';
import {
  createKeyCipher,
  importLegacyCompany,
  isDomainError,
  reconcileLegacyImport,
  systemClock,
  type LegacyExport,
} from '@comprobify/core';
import { inOneTransaction } from '@comprobify/db';
import pg from 'pg';

const { values } = parseArgs({
  options: {
    ruc: { type: 'string' },
    'super-admin': { type: 'string' },
    'leave-out': { type: 'string', multiple: true, default: [] },
    plan: { type: 'string', default: 'ENTERPRISE' },
    'leave-unpaid': { type: 'boolean', default: false },
    commit: { type: 'boolean', default: false },
  },
});
if (!values.ruc || !values['super-admin']) {
  console.error(
    'Usage: pnpm import:legacy --ruc <ruc> --super-admin <email> [--leave-out <email>]... [--plan KEY] [--leave-unpaid] [--commit]',
  );
  process.exit(1);
}
const ruc = values.ruc;

const env = loadLegacyImportEnv();
const logger = createLogger({ service: 'import-legacy', level: 'warn' });

async function read<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // A copy, read only: nothing here ever writes to it.
    await client.query('SET default_transaction_read_only = on');
    return await run(client);
  } finally {
    await client.end();
  }
}

type Export = LegacyExport;
type Issuer = Export['issuers'][number] & { id: string; tenantId: string };
type Document = Omit<Export['documents'][number], 'events' | 'sriResponses'> & { id: string };
type Event = Export['documents'][number]['events'][number] & { documentId: string };
type Response = Export['documents'][number]['sriResponses'][number] & { documentId: string };

const exported = async (): Promise<Export> => {
  const api = await read(env.LEGACY_API_DATABASE_URL, async (db) => {
    const issuers = await db.query<
      Issuer & Omit<Export['company'], 'contactEmail' | 'idleTimeoutMinutes'>
    >(
      `SELECT i.id, i.tenant_id AS "tenantId", i.ruc, i.business_name AS "legalName",
          i.trade_name AS "tradeName", i.main_address AS "mainAddress",
          i.required_accounting AS "requiredAccounting", i.special_taxpayer AS "specialTaxpayer",
          i.agent_retention AS "withholdingAgent", i.contribuyente_rimpe AS rimpe,
          i.branch_code AS "branchCode", i.issue_point_code AS "issuePointCode",
          i.branch_address AS "branchAddress", i.can_issue AS "canIssue", i.active,
          i.encrypted_private_key AS "encryptedPrivateKey", i.certificate_pem AS "certificatePem",
          i.cert_fingerprint AS "certificateFingerprint", i.logo,
          ARRAY(SELECT d.document_type FROM issuer_document_types d
                 WHERE d.issuer_id = i.id AND d.active) AS "documentTypes"
         FROM issuers i JOIN tenants t ON t.id = i.tenant_id
        WHERE i.ruc = $1 AND NOT t.sandbox ORDER BY i.created_at`,
      [ruc],
    );
    if (issuers.rows.length === 0) throw new Error(`No issuer with RUC ${ruc} in the API copy`);
    if (new Set(issuers.rows.map((row) => row.tenantId)).size > 1)
      throw new Error(`RUC ${ruc} belongs to more than one tenant`);
    const ids = issuers.rows.map((row) => row.id);
    // The public schema only: the sandbox one is test data, not imported.
    const sequentials = await db.query<Export['sequentials'][number]>(
      `SELECT branch_code AS "branchCode", issue_point_code AS "issuePointCode",
          document_type AS "documentType", current_value AS "currentValue"
         FROM public.sequential_numbers WHERE issuer_id = ANY($1)`,
      [ids],
    );
    const documents = await db.query<Document>(
      `SELECT id, document_type AS "documentType", access_key AS "accessKey", sequential,
          branch_code AS "branchCode", issue_point_code AS "issuePointCode", status,
          signed_xml AS "signedXml", authorization_xml AS "authorizationXml",
          authorization_number AS "authorizationNumber", authorization_date AS "authorizationDate",
          buyer_email AS "buyerEmail", void_reason AS "voidReason", voided_at AS "voidedAt",
          created_at AS "createdAt"
         FROM public.documents WHERE issuer_id = ANY($1) ORDER BY sequential`,
      [ids],
    );
    const documentIds = documents.rows.map((row) => row.id);
    const events = await db.query<Event>(
      `SELECT document_id AS "documentId", event_type AS "eventType", from_status AS "fromStatus",
          to_status AS "toStatus", detail, created_at AS "createdAt"
         FROM public.document_events WHERE document_id = ANY($1) ORDER BY created_at, id`,
      [documentIds],
    );
    const responses = await db.query<Response>(
      `SELECT document_id AS "documentId", operation_type AS "operationType", status, messages,
          raw_response AS "rawResponse", created_at AS "createdAt"
         FROM public.sri_responses WHERE document_id = ANY($1) ORDER BY created_at, id`,
      [documentIds],
    );
    return {
      issuers: issuers.rows,
      sequentials: sequentials.rows,
      documents: documents.rows.map(({ id, ...document }) => ({
        ...document,
        events: events.rows
          .filter((event) => event.documentId === id)
          .map(({ eventType, fromStatus, toStatus, detail, createdAt }) => ({
            eventType,
            fromStatus,
            toStatus,
            detail,
            createdAt,
          })),
        sriResponses: responses.rows
          .filter((response) => response.documentId === id)
          .map(({ operationType, status, messages, rawResponse, createdAt }) => ({
            operationType,
            status,
            messages,
            rawResponse,
            createdAt,
          })),
      })),
    };
  });

  const web = await read(env.LEGACY_WEB_DATABASE_URL, async (db) => {
    const tenants = await db.query<{
      id: string;
      contactEmail: string | null;
      idleTimeoutMinutes: number | null;
    }>(
      `SELECT id, contact_email AS "contactEmail",
          session_idle_timeout_minutes AS "idleTimeoutMinutes"
         FROM tenants WHERE ruc = $1`,
      [ruc],
    );
    const tenant = tenants.rows[0];
    if (!tenant) throw new Error(`No tenant with RUC ${ruc} in the web copy`);
    // The company's members, and the accounts that never made a company.
    const users = await db.query<Export['users'][number]>(
      `SELECT email, first_name AS "firstName", last_name AS "lastName",
          password_hash AS "passwordHash", CASE WHEN tenant_id IS NULL THEN NULL ELSE role END AS role,
          created_at AS "createdAt"
         FROM users WHERE tenant_id = $1 OR tenant_id IS NULL ORDER BY created_at`,
      [tenant.id],
    );
    const clients = await db.query<Export['clients'][number]>(
      `SELECT id_type AS "idType", id_number AS identification, name, NULLIF(email, '') AS email,
          address
         FROM clients WHERE tenant_id = $1 ORDER BY created_at`,
      [tenant.id],
    );
    const products = await db.query<Export['products'][number]>(
      `SELECT main_code AS code, aux_code AS "auxiliaryCode", description AS name,
          unit_price::text AS "unitPrice", tax_option AS "taxOption"
         FROM products WHERE tenant_id = $1 ORDER BY created_at`,
      [tenant.id],
    );
    const templates = await db.query<Export['templates'][number]>(
      `SELECT name, document_type AS "documentType", data
         FROM document_templates WHERE tenant_id = $1 ORDER BY created_at`,
      [tenant.id],
    );
    return {
      tenant,
      users: users.rows,
      clients: clients.rows,
      products: products.rows,
      templates: templates.rows,
    };
  });

  const first = api.issuers[0]!;
  return {
    company: {
      ruc,
      legalName: first.legalName,
      tradeName: first.tradeName,
      mainAddress: first.mainAddress,
      requiredAccounting: first.requiredAccounting,
      specialTaxpayer: first.specialTaxpayer,
      withholdingAgent: first.withholdingAgent,
      rimpe: first.rimpe,
      contactEmail: web.tenant.contactEmail,
      idleTimeoutMinutes: web.tenant.idleTimeoutMinutes,
    },
    issuers: api.issuers,
    sequentials: api.sequentials,
    documents: api.documents,
    users: web.users,
    clients: web.clients,
    products: web.products,
    templates: web.templates,
  };
};

class ReconciliationFailed extends Error {}

const data = await exported();
const commit = values.commit;
try {
  const { result, reconciliation } = await inOneTransaction(
    { connectionString: env.DATABASE_URL, logger, commit },
    async (db) => {
      await db.assertSafeConnection();
      const result = await importLegacyCompany(db, data, {
        superAdminEmail: values['super-admin']!,
        leaveOut: values['leave-out'],
        planKey: values.plan,
        markCollected: !values['leave-unpaid'],
        legacyKeyHex: env.LEGACY_ENCRYPTION_KEY,
        keyCipher: createKeyCipher(env.CERT_ENCRYPTION_KEY),
        clock: systemClock,
      });
      const reconciliation = await reconcileLegacyImport(db, data, result);
      print(result, reconciliation);
      if (commit && !reconciliation.ok) throw new ReconciliationFailed();
      return { result, reconciliation };
    },
  );
  console.log(
    commit
      ? `\nCommitted: ${result.realTenantId} is the company.`
      : `\nDry run: ${reconciliation.ok ? 'every check passed' : 'some checks failed'}; nothing was kept. Add --commit to keep it.`,
  );
  if (!reconciliation.ok) process.exitCode = 1;
} catch (error) {
  if (error instanceof ReconciliationFailed) console.error('\nA check failed: nothing was kept.');
  else if (isDomainError(error))
    console.error(`\nRefused (${error.code}): ${error.message}`, error.details ?? '');
  else console.error('\nThe import failed: nothing was kept.', error);
  process.exitCode = 1;
}

function print(
  result: Awaited<ReturnType<typeof importLegacyCompany>>,
  reconciliation: Awaited<ReturnType<typeof reconcileLegacyImport>>,
) {
  console.log(`Company ${ruc}: real ${result.realTenantId}, test copy ${result.twinTenantId}`);
  for (const account of result.accounts)
    console.log(
      `  account ${account.email}${account.owner ? ' (owner)' : ''}${account.superAdmin ? ' (super admin)' : ''}${account.password ? '' : ' (no password)'}`,
    );
  console.log(
    `  ${result.documents.length} documents, ${result.collected} marked collected, ${result.signedOnly} authorized as signed, ${result.clients} clients, ${result.products} products, ${result.templates} templates, ${result.skippedEvents} timeline entries left out`,
  );
  for (const problem of result.problems)
    console.log(`  left out ${problem.kind} ${problem.name}: ${problem.reason}`);
  console.log('\nReconciliation');
  for (const check of reconciliation.checks)
    console.log(
      `  ${check.ok ? 'ok  ' : 'FAIL'} ${check.check}: ${check.ok ? check.actual : `expected ${check.expected}, found ${check.actual}`}`,
    );
}
