import { DOCUMENT_STATUSES, eq, schema, type Database, type DocumentStatus } from '@comprobify/db';
import { ZodError } from 'zod';
import { recordAudit } from '../audit';
import { createProduct } from '../catalog';
import { certificateMatchesRuc, parseCertificatePair, type KeyCipher } from '../certificates';
import { importDocument, saveTemplate } from '../documents';
import { importAccount, resolvePlatformActor } from '../identity';
import { DomainError, hasFeature, isDomainError, type ActorContext, type Clock } from '../kernel';
import { createClient } from '../parties';
import { changePlan, setBilling } from '../platform';
import { recordPayment } from '../receivables';
import { CONSUMER_FINAL_ID_TYPE, readFactura, SELECTABLE_IVA_RATES } from '../sri';
import {
  createOrganization,
  goLive,
  resolveActor,
  setIdleTimeout,
  sniffLogo,
  updateCompanyProfile,
} from '../tenancy';
import { decryptLegacyValue, legacyExportInput, type LegacyExport } from './input';

// ADR-049: one company from the previous system, through core's own workflows, so the result
// is what onboarding, go-live and the screens would have made. The caller runs it in one
// transaction (inOneTransaction): any refusal leaves nothing behind.

export type LegacyImportOptions = {
  // Gets the platform flag; the previous system's flags are not carried over.
  superAdminEmail: string;
  // Accounts left behind.
  leaveOut: string[];
  planKey: string;
  // The previous system kept no collections; its invoices were settled outside it.
  markCollected: boolean;
  legacyKeyHex: string;
  keyCipher: KeyCipher;
  clock: Clock;
};

// Left out, not fatal: the operator reads them in the report and decides.
export type LegacyImportProblem = {
  kind: 'client' | 'product' | 'template';
  name: string;
  reason: string;
};

export type LegacyImportResult = {
  realTenantId: string;
  twinTenantId: string;
  accounts: { email: string; superAdmin: boolean; owner: boolean; password: boolean }[];
  documents: { accessKey: string; id: string; status: DocumentStatus }[];
  clients: number;
  products: number;
  templates: number;
  collected: number;
  // Documents whose authorized copy is their signed XML (none kept by the previous system).
  signedOnly: number;
  skippedEvents: number;
  problems: LegacyImportProblem[];
};

const refuse = (message: string, details?: Record<string, unknown>): never => {
  throw new DomainError('LEGACY_IMPORT_REFUSED', message, details);
};

const FINAL_STATUSES = ['AUTHORIZED', 'VOIDED'] as const;
const OWNER_ROLE = 'Owner';

const asStatus = (value: string | null): DocumentStatus | null =>
  value && (DOCUMENT_STATUSES as readonly string[]).includes(value)
    ? (value as DocumentStatus)
    : null;

// '2-4' is IVA at rate code 4.
const rateOf = (taxOption: string): string | null => {
  const [tax, rate] = taxOption.split('-');
  return tax === '2' && rate && (SELECTABLE_IVA_RATES as readonly string[]).includes(rate)
    ? rate
    : null;
};

const reasonOf = (error: unknown): string =>
  error instanceof ZodError
    ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    : isDomainError(error) || error instanceof Error
      ? error.message
      : String(error);

const regimeOf = (rimpe: string | null) =>
  !rimpe
    ? ('GENERAL' as const)
    : /POPULAR/i.test(rimpe)
      ? ('RIMPE_NEGOCIO_POPULAR' as const)
      : /RIMPE/i.test(rimpe)
        ? ('RIMPE_EMPRENDEDOR' as const)
        : ('GENERAL' as const);

type Doc = ReturnType<typeof legacyExportInput.parse>['documents'][number];

type ImportedEvent = {
  type: 'CREATED' | 'STATUS_CHANGED' | 'VOIDED' | 'EMAILED';
  fromStatus: DocumentStatus | null;
  toStatus: DocumentStatus | null;
  details: Record<string, unknown>;
  occurredAt: Date;
};

// The previous timeline, in the new one's types. E-mail delivery reports have no place in it.
function timeline(doc: Doc) {
  let skipped = 0;
  const events = doc.events.flatMap((event): ImportedEvent[] => {
    const base = {
      fromStatus: asStatus(event.fromStatus),
      toStatus: asStatus(event.toStatus),
      details: event.detail ?? {},
      occurredAt: event.createdAt,
    };
    switch (event.eventType) {
      case 'CREATED':
        return [{ ...base, type: 'CREATED', details: { ...base.details, imported: true } }];
      case 'STATUS_CHANGED':
      case 'SENT':
        return [{ ...base, type: 'STATUS_CHANGED' }];
      case 'VOIDED':
        return [{ ...base, type: 'VOIDED' }];
      case 'EMAIL_SENT':
        return [
          {
            ...base,
            type: 'EMAILED',
            details: {
              to: event.detail?.to ?? doc.buyerEmail,
              resend: event.detail?.retried === true,
            },
          },
        ];
      default:
        skipped += 1;
        return [];
    }
  });
  if (doc.status === 'VOIDED' && !events.some((event) => event.type === 'VOIDED'))
    events.push({
      type: 'VOIDED',
      fromStatus: 'AUTHORIZED',
      toStatus: 'VOIDED',
      details: { reason: doc.voidReason },
      occurredAt: doc.voidedAt ?? doc.createdAt,
    });
  return { events, skipped };
}

const OPERATIONS: Record<string, 'reception' | 'authorization' | 'validity'> = {
  RECEPTION: 'reception',
  AUTHORIZATION: 'authorization',
};
const OUTCOMES: Record<
  string,
  'RECEIVED' | 'RETURNED' | 'AUTHORIZED' | 'NOT_AUTHORIZED' | 'PENDING'
> = {
  RECIBIDA: 'RECEIVED',
  DEVUELTA: 'RETURNED',
  AUTORIZADO: 'AUTHORIZED',
  'NO AUTORIZADO': 'NOT_AUTHORIZED',
  'EN PROCESO': 'PENDING',
};

// SRI's own field names, or already in this system's.
const textOf = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
  }
  return null;
};
const messagesOf = (raw: unknown) =>
  (Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []).map((entry) => ({
    identifier: textOf(entry.identificador, entry.identifier) ?? '',
    message: textOf(entry.mensaje, entry.message) ?? '',
    additionalInfo: textOf(entry.informacionAdicional, entry.additionalInfo),
  }));

function exchangesOf(doc: Doc) {
  return doc.sriResponses.flatMap((response) => {
    const operation = OPERATIONS[response.operationType];
    return operation
      ? [
          {
            operation,
            outcome: OUTCOMES[response.status ?? ''] ?? ('TRANSPORT_ERROR' as const),
            messages: messagesOf(response.messages),
            raw: response.rawResponse,
            occurredAt: response.createdAt,
          },
        ]
      : [];
  });
}

const nameOf = (user: { firstName: string | null; lastName: string | null; email: string }) =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email.split('@')[0]!;

export async function importLegacyCompany(
  db: Database,
  raw: LegacyExport,
  options: LegacyImportOptions,
): Promise<LegacyImportResult> {
  const data = legacyExportInput.parse(raw);
  const { clock } = options;
  const leaveOut = new Set(options.leaveOut.map((email) => email.trim().toLowerCase()));
  const superAdminEmail = options.superAdminEmail.trim().toLowerCase();

  // What this import knows how to bring: one issue point issuing facturas, finished documents.
  const [issuer, ...others] = data.issuers.filter((one) => one.active);
  if (!issuer || others.length > 0) refuse('Exactly one active issuer is imported');
  if (issuer!.documentTypes.some((type) => type !== '01')) refuse('Only facturas are imported');
  const unfinished = data.documents.filter(
    (doc) => !(FINAL_STATUSES as readonly string[]).includes(doc.status),
  );
  if (unfinished.length > 0)
    refuse('Documents still waiting for SRI: let them finish before the dump', {
      accessKeys: unfinished.map((doc) => doc.accessKey),
    });
  if (data.documents.some((doc) => doc.documentType !== '01')) refuse('Only facturas are imported');
  const sequentials = data.sequentials.filter((one) => one.currentValue > 0);
  if (
    sequentials.some(
      (one) =>
        one.documentType !== '01' ||
        one.branchCode !== issuer!.branchCode ||
        one.issuePointCode !== issuer!.issuePointCode,
    )
  )
    refuse('Sequentials outside the issuer’s facturas', { sequentials });
  const lastInvoice = sequentials[0]?.currentValue ?? 0;
  const highest = Math.max(0, ...data.documents.map((doc) => doc.sequential));
  if (highest > lastInvoice) refuse('A document is numbered past its sequential', { highest });
  // SRI authorizes the signed document as it is: where the previous system kept no copy of the
  // authorized one, the signed XML is it.
  const authorizedXml = (doc: Doc) => doc.authorizationXml ?? doc.signedXml;
  for (const doc of data.documents)
    if (!doc.signedXml || !doc.authorizationNumber || !doc.authorizationDate)
      refuse('A finished document without its XML or authorization', { accessKey: doc.accessKey });
  const read = new Map(
    data.documents.map((doc) => {
      const factura = readFactura(authorizedXml(doc)!);
      if (factura.accessKey !== doc.accessKey || factura.sequential !== doc.sequential)
        refuse('A document’s XML does not match its row', { accessKey: doc.accessKey });
      return [doc.accessKey, factura];
    }),
  );

  // Accounts first: the owner holds the company, and the operator the platform flag.
  const users = data.users.filter((user) => !leaveOut.has(user.email.trim().toLowerCase()));
  if (users.some((user) => user.role !== null && user.role !== OWNER_ROLE))
    refuse('Only the owner is imported as a member');
  const owners = users.filter((user) => user.role === OWNER_ROLE);
  if (owners.length !== 1) refuse('Exactly one owner is imported');
  if (!users.some((user) => user.email.trim().toLowerCase() === superAdminEmail))
    refuse('The super admin is not among the imported accounts');
  const accounts: LegacyImportResult['accounts'] = [];
  let ownerId = '';
  let superAdminId = '';
  for (const user of users) {
    const email = user.email.trim().toLowerCase();
    const owner = user.role === OWNER_ROLE;
    const { id } = await importAccount(db.identity, {
      name: nameOf(user),
      email,
      // A member proved the address by using the company; an account that never did verifies it.
      emailVerified: owner,
      isSuperAdmin: email === superAdminEmail,
      passwordHash: user.passwordHash,
      createdAt: user.createdAt,
    });
    if (owner) ownerId = id;
    if (email === superAdminEmail) superAdminId = id;
    accounts.push({
      email,
      superAdmin: email === superAdminEmail,
      owner,
      password: !!user.passwordHash,
    });
  }

  // The certificate, decrypted with the previous key and stored under this system's (PRD 9.3).
  if (!issuer!.encryptedPrivateKey || !issuer!.certificatePem)
    refuse('The issuer has no certificate');
  const parsed = parseCertificatePair(
    decryptLegacyValue(issuer!.encryptedPrivateKey!, options.legacyKeyHex),
    issuer!.certificatePem!,
    clock.now(),
  );
  if (!certificateMatchesRuc(parsed.identifiers, data.company.ruc))
    refuse('The certificate does not belong to this RUC');

  const company = data.company;
  const created = await createOrganization(
    db,
    {
      ownerUserId: ownerId,
      ruc: company.ruc,
      legalName: company.legalName,
      tradeName: company.tradeName,
      mainAddress: company.mainAddress,
      branch: {
        code: issuer!.branchCode,
        name: issuer!.branchCode === '001' ? 'Matriz' : `Sucursal ${issuer!.branchCode}`,
        address: issuer!.branchAddress,
      },
      issuePointCode: issuer!.issuePointCode,
      // FR-ONB-5: the numbering continues exactly where the previous system left it.
      firstInvoiceNumber: lastInvoice + 1,
      requiredAccounting: company.requiredAccounting === 'SI',
      taxRegime: regimeOf(company.rimpe),
      contactEmail: company.contactEmail,
    },
    {
      certificate: {
        encryptedPrivateKey: options.keyCipher.encrypt(parsed.privateKeyPem),
        certificatePem: parsed.certificatePem,
        fingerprint: parsed.fingerprint,
        subjectName: parsed.subjectName,
        issuerName: parsed.issuerName,
        notBefore: parsed.notBefore,
        notAfter: parsed.notAfter,
      },
      logo: issuer!.logo ? sniffLogo(Buffer.from(issuer!.logo)) : undefined,
      clock,
    },
  );

  let actor = await resolveActor(db, { userId: ownerId, tenantId: created.realTenantId, clock });
  if (company.specialTaxpayer || company.withholdingAgent)
    await updateCompanyProfile(actor, db, {
      tradeName: company.tradeName,
      mainAddress: company.mainAddress,
      requiredAccounting: company.requiredAccounting === 'SI',
      specialTaxpayerResolution: company.specialTaxpayer,
      withholdingAgentResolution: company.withholdingAgent,
      taxRegime: regimeOf(company.rimpe),
    });
  if (company.idleTimeoutMinutes) await setIdleTimeout(actor, db, company.idleTimeoutMinutes);

  // The operator's own company: its plan, free of charge (FR-PLAN-1b).
  const platform = await resolvePlatformActor(db.identity, { userId: superAdminId, clock });
  await changePlan(platform, db, { realTenantId: created.realTenantId, planKey: options.planKey });
  await setBilling(platform, db, {
    realTenantId: created.realTenantId,
    complimentary: true,
    reason: 'Empresa del operador, traída del sistema anterior',
  });
  await goLive(actor, db, { requireAgreements: false });
  // The plan changed: the actor carries the new features.
  actor = await resolveActor(db, { userId: ownerId, tenantId: created.realTenantId, clock });

  const problems: LegacyImportProblem[] = [];
  const productIds = new Map<string, string>();
  for (const product of data.products) {
    const rate = rateOf(product.taxOption);
    if (!rate) {
      problems.push({ kind: 'product', name: product.code, reason: `IVA ${product.taxOption}` });
      continue;
    }
    try {
      const row = await createProduct(actor, db, {
        code: product.code,
        auxiliaryCode: product.auxiliaryCode,
        name: product.name,
        kind: 'SERVICE',
        price: product.unitPrice,
        ivaRateCode: rate,
      });
      productIds.set(product.code, row.id);
    } catch (error) {
      problems.push({ kind: 'product', name: product.code, reason: reasonOf(error) });
    }
  }

  // The saved clients, then every buyer the documents name that isn't one of them.
  const candidates = new Map<string, (typeof data.clients)[number]>();
  for (const client of data.clients)
    candidates.set(`${client.idType}:${client.identification}`, client);
  for (const doc of data.documents) {
    const buyer = read.get(doc.accessKey)!.buyer;
    const key = `${buyer.idType}:${buyer.identification}`;
    if (buyer.idType !== CONSUMER_FINAL_ID_TYPE && !candidates.has(key))
      candidates.set(key, {
        idType: buyer.idType,
        identification: buyer.identification,
        name: buyer.name,
        email: doc.buyerEmail,
        address: buyer.address,
      });
  }
  const clientIds = new Map<string, string>();
  for (const [key, client] of candidates) {
    try {
      const row = await createClient(actor, db, {
        idType: client.idType,
        identification: client.identification,
        name: client.name,
        emails: client.email ? [client.email] : [],
        address: client.address,
      });
      clientIds.set(key, row.id);
    } catch (error) {
      problems.push({ kind: 'client', name: client.name, reason: reasonOf(error) });
    }
  }

  const documents: LegacyImportResult['documents'] = [];
  let skippedEvents = 0;
  let collected = 0;
  let signedOnly = 0;
  const canCollect = options.markCollected && hasFeature(actor, 'RECEIVABLES');
  const issuePointId = await issuePointOf(actor, db);
  for (const doc of [...data.documents].sort((a, b) => a.sequential - b.sequential)) {
    const factura = read.get(doc.accessKey)!;
    const { events, skipped } = timeline(doc);
    skippedEvents += skipped;
    const row = await importDocument(actor, db, {
      issuePointId,
      clientId: clientIds.get(`${factura.buyer.idType}:${factura.buyer.identification}`) ?? null,
      buyerEmail: doc.buyerEmail,
      status: doc.status as (typeof FINAL_STATUSES)[number],
      signedXml: doc.signedXml!,
      authorizationXml: authorizedXml(doc)!,
      authorizationNumber: doc.authorizationNumber!,
      authorizedAt: doc.authorizationDate!,
      createdAt: doc.createdAt,
      events,
      exchanges: exchangesOf(doc),
    });
    documents.push({ ...row, status: doc.status as DocumentStatus });
    if (!doc.authorizationXml) signedOnly += 1;
    if (canCollect && doc.status === 'AUTHORIZED') {
      await recordPayment(actor, db, {
        documentId: row.id,
        amount: factura.total,
        paidOn: factura.issueDate,
        method: (factura.payments[0]?.method ?? '20') as '20',
        reference: 'Sistema anterior',
      });
      collected += 1;
    }
  }

  let templates = 0;
  for (const template of data.templates.filter((one) => one.documentType === '01')) {
    try {
      await saveTemplate(actor, db, {
        name: template.name,
        content: templateContent(template.data, clientIds, productIds),
      });
      templates += 1;
    } catch (error) {
      problems.push({ kind: 'template', name: template.name, reason: reasonOf(error) });
    }
  }

  const result: LegacyImportResult = {
    ...created,
    accounts,
    documents,
    clients: clientIds.size,
    products: productIds.size,
    templates,
    collected,
    signedOnly,
    skippedEvents,
    problems,
  };
  await db.withSystem('record a company imported from the previous system', ({ db: tx }) =>
    recordAudit(tx, {
      tenantId: created.realTenantId,
      actorUserId: superAdminId,
      action: 'organization.imported',
      details: {
        documents: documents.length,
        clients: result.clients,
        products: result.products,
        templates,
        nextInvoice: lastInvoice + 1,
      },
    }),
  );
  return result;
}

// The company's one issue point, as onboarding made it.
async function issuePointOf(ctx: ActorContext, db: Database): Promise<string> {
  const [point] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx
      .select({ id: schema.issuePoints.id })
      .from(schema.issuePoints)
      .where(eq(schema.issuePoints.tenantId, ctx.tenantId)),
  );
  return point!.id;
}

type OldTemplate = {
  buyer?: { id?: string; idType?: string };
  items?: {
    mainCode?: string;
    auxCode?: string | null;
    description?: string;
    quantity?: string;
    unitPrice?: string;
    discount?: string;
    taxOption?: string;
    additionalDetails?: { name: string; value: string }[];
  }[];
  payments?: { method?: string; total?: string }[];
  additionalInfo?: { name: string; value: string }[];
};

// The previous app's template, in the invoice form's terms; saveTemplate checks the result.
function templateContent(
  raw: unknown,
  clientIds: Map<string, string>,
  productIds: Map<string, string>,
) {
  const data = (raw ?? {}) as OldTemplate;
  const buyer = data.buyer;
  return {
    clientId:
      buyer?.idType && buyer.id ? (clientIds.get(`${buyer.idType}:${buyer.id}`) ?? null) : null,
    lines: (data.items ?? []).map((item) => ({
      productId: item.mainCode ? (productIds.get(item.mainCode) ?? null) : null,
      code: item.mainCode ?? '',
      auxiliaryCode: item.auxCode || null,
      name: item.description ?? '',
      quantity: item.quantity ?? '',
      unitPrice: item.unitPrice ?? '',
      discount: item.discount ?? '0',
      ivaRateCode: rateOf(item.taxOption ?? '') ?? '',
      additionalDetails: item.additionalDetails ?? [],
    })),
    payments: (data.payments ?? []).map((payment) => ({
      method: (payment.method ?? '') as '20',
      amount: payment.total ?? '',
    })),
    additionalInfo: data.additionalInfo ?? [],
  };
}
