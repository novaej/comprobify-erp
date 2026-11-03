import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AGREEMENT_TYPES, desc, eq, schema, type Database, type Tx } from '@comprobify/db';
import { recordAudit } from '../audit';
import { DomainError, requirePermission, type ActorContext } from '../kernel';

export type AgreementType = (typeof AGREEMENT_TYPES)[number];
export { AGREEMENT_TYPES };

const FILES: Record<AgreementType, string> = {
  TERMS: 'terms-of-service.md',
  PRIVACY: 'privacy-policy.md',
  DPA: 'data-processing-agreement.md',
};

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

// The migrate step: a text edited in the repo becomes the next version, so every
// company is asked to accept it again (FR-ONB-8). Same text, nothing published.
export async function publishAgreements(db: Database): Promise<AgreementType[]> {
  const published: AgreementType[] = [];
  await db.withSystem('publish legal texts from the repository', async ({ db: tx }) => {
    const { agreementTemplates } = schema;
    for (const type of AGREEMENT_TYPES) {
      const content = await readFile(new URL(`./texts/${FILES[type]}`, import.meta.url), 'utf8');
      const [current] = await tx
        .select()
        .from(agreementTemplates)
        .where(eq(agreementTemplates.documentType, type))
        .orderBy(desc(agreementTemplates.version))
        .limit(1);
      if (current?.contentHash === hash(content)) continue;
      await tx.insert(agreementTemplates).values({
        documentType: type,
        version: (current?.version ?? 0) + 1,
        contentMarkdown: content,
        contentHash: hash(content),
      });
      published.push(type);
    }
  });
  return published;
}

export type AgreementParties = {
  operator: { name: string; ruc: string; address: string; supportEmail: string };
};

// Every placeholder must be filled: a copy with a stray {{...}} is never shown or stored.
export function personalize(
  markdown: string,
  parties: AgreementParties,
  client: { legalName: string; ruc: string },
): string {
  const values: Record<string, string> = {
    'operador.nombre': parties.operator.name,
    'operador.ruc': parties.operator.ruc,
    'operador.domicilio': parties.operator.address,
    'soporte.email': parties.operator.supportEmail,
    'cliente.razonSocial': client.legalName,
    'cliente.ruc': client.ruc,
  };
  return markdown.replace(/\{\{([a-zA-Z.]+)\}\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`Unknown placeholder {{${key}}}`);
    return value;
  });
}

type Company = { realTenantId: string; legalName: string; ruc: string };

// Acceptances belong to the real company; the twin reads them through it.
async function companyOf(db: Database, ctx: ActorContext): Promise<Company> {
  const realTenantId = await db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const [tenant] = await tx
      .select({ id: schema.tenants.id, twinOf: schema.tenants.twinOf })
      .from(schema.tenants);
    return tenant!.twinOf ?? tenant!.id;
  });
  // Read in the real company, which the actor belongs to through the mirrored membership.
  return db.withTenant({ tenantId: realTenantId }, async ({ db: tx }) => {
    const [real] = await tx
      .select({ legalName: schema.tenants.legalName, ruc: schema.tenants.ruc })
      .from(schema.tenants);
    return { realTenantId, legalName: real!.legalName, ruc: real!.ruc };
  });
}

async function currentTemplates(tx: Tx['db']) {
  const { agreementTemplates } = schema;
  const rows = await tx.select().from(agreementTemplates).orderBy(desc(agreementTemplates.version));
  return AGREEMENT_TYPES.map((type) => rows.find((row) => row.documentType === type)).filter(
    (row): row is NonNullable<typeof row> => Boolean(row),
  );
}

export type AgreementStatus = {
  type: AgreementType;
  version: number;
  accepted: boolean;
  acceptedAt: Date | null;
};

// For every member: which current versions the company has accepted.
export async function agreementStatus(ctx: ActorContext, db: Database): Promise<AgreementStatus[]> {
  const company = await companyOf(db, ctx);
  return db.withTenant({ tenantId: company.realTenantId }, async ({ db: tx }) => {
    const templates = await currentTemplates(tx);
    const accepted = await tx.select().from(schema.agreementAcceptances);
    return templates.map((template) => {
      const row = accepted.find((acceptance) => acceptance.templateId === template.id);
      return {
        type: template.documentType,
        version: template.version,
        accepted: Boolean(row),
        acceptedAt: row?.acceptedAt ?? null,
      };
    });
  });
}

// The company's own copy of the current version, as it would be (or was) accepted.
export async function companyAgreement(
  ctx: ActorContext,
  db: Database,
  type: AgreementType,
  parties: AgreementParties,
): Promise<{ markdown: string; version: number } | null> {
  const company = await companyOf(db, ctx);
  return db.withTenant({ tenantId: company.realTenantId }, async ({ db: tx }) => {
    const template = (await currentTemplates(tx)).find((row) => row.documentType === type);
    if (!template) return null;
    const [accepted] = await tx
      .select({ markdown: schema.agreementAcceptances.contentMarkdown })
      .from(schema.agreementAcceptances)
      .where(eq(schema.agreementAcceptances.templateId, template.id));
    return {
      markdown: accepted?.markdown ?? personalize(template.contentMarkdown, parties, company),
      version: template.version,
    };
  });
}

// FR-ONB-8: one acceptance covers the three texts, each recorded as its own row with
// the exact copy, who accepted it and from where. Owner only: it binds the company.
export async function acceptAgreements(
  ctx: ActorContext,
  db: Database,
  input: { ipAddress: string | null; userAgent: string | null },
  parties: AgreementParties,
): Promise<void> {
  requirePermission(ctx, 'organization.accept_agreements');
  const company = await companyOf(db, ctx);
  await db.withSystem('record acceptance of the legal texts', async ({ db: tx }) => {
    const templates = await currentTemplates(tx);
    if (templates.length === 0)
      throw new DomainError('NO_AGREEMENTS', 'No legal texts are published');
    const versions: string[] = [];
    for (const template of templates) {
      const content = personalize(template.contentMarkdown, parties, company);
      const inserted = await tx
        .insert(schema.agreementAcceptances)
        .values({
          tenantId: company.realTenantId,
          templateId: template.id,
          documentType: template.documentType,
          version: template.version,
          contentMarkdown: content,
          contentHash: hash(content),
          acceptedBy: ctx.userId!,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: schema.agreementAcceptances.id });
      if (inserted[0]) versions.push(`${template.documentType} v${template.version}`);
    }
    if (versions.length > 0) {
      await recordAudit(tx, {
        tenantId: company.realTenantId,
        actorUserId: ctx.userId ?? null,
        action: 'agreements.accepted',
        details: { versions },
      });
    }
  });
}

// For go-live: has the company accepted every current version?
export async function agreementsAccepted(tx: Tx['db'], realTenantId: string): Promise<boolean> {
  const templates = await currentTemplates(tx);
  const accepted = await tx
    .select({ templateId: schema.agreementAcceptances.templateId })
    .from(schema.agreementAcceptances)
    .where(eq(schema.agreementAcceptances.tenantId, realTenantId));
  return templates.every((template) => accepted.some((row) => row.templateId === template.id));
}
