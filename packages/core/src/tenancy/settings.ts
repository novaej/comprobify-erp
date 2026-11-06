import {
  and,
  asc,
  count,
  eq,
  inArray,
  schema,
  sql,
  TAX_REGIMES,
  type Database,
  type Tx,
} from '@comprobify/db';
import { z } from 'zod';
import { recordAudit } from '../audit';
import {
  DomainError,
  requireFeature,
  requirePermission,
  requireWithinLimit,
  type ActorContext,
} from '../kernel';
import { pairOf, type Pair } from './pair';

// The company's tax data, branches, issue points and the document types each issues.
// Every change lands in the company and its twin together, matched by code, so testing
// mirrors the real setup; each keeps its own sequences (SRI rule 9).

export { TAX_REGIMES };

// The types a builder and its creation exist for (FR-DOC-1).
export const ISSUABLE_DOCUMENT_TYPES = ['01', '04', '06'] as const;

const code = z.string().regex(/^[0-9]{3}$/);
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\n\r\t]*$/);

export const companyProfileInput = z.object({
  tradeName: line(300).nullable(),
  mainAddress: line(300),
  requiredAccounting: z.boolean(),
  // The factura XSD's own patterns.
  specialTaxpayerResolution: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{3,13}$/)
    .nullable(),
  withholdingAgentResolution: z
    .string()
    .trim()
    .regex(/^[0-9]{1,8}$/)
    .nullable(),
  taxRegime: z.enum(TAX_REGIMES),
});

export const branchInput = z.object({ code, name: line(120), address: line(300) });

export type CompanySettings = {
  profile: {
    ruc: string;
    legalName: string;
    tradeName: string | null;
    mainAddress: string;
    requiredAccounting: boolean;
    specialTaxpayerResolution: string | null;
    withholdingAgentResolution: string | null;
    taxRegime: (typeof TAX_REGIMES)[number];
  };
  branches: {
    id: string;
    code: string;
    name: string;
    address: string;
    issuePoints: { id: string; code: string; canIssue: boolean; documentTypes: string[] }[];
  }[];
};

const tenantsOf = (pair: Pair) =>
  [pair.realTenantId, pair.twinTenantId].filter((id): id is string => id !== null);

export async function companySettings(ctx: ActorContext, db: Database): Promise<CompanySettings> {
  requirePermission(ctx, 'organization.manage');
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const { tenants, branches, issuePoints, issuePointDocumentTypes } = schema;
    const [tenant] = await tx.select().from(tenants);
    const branchRows = await tx
      .select()
      .from(branches)
      .where(eq(branches.active, true))
      .orderBy(asc(branches.code));
    const pointRows = await tx
      .select()
      .from(issuePoints)
      .where(eq(issuePoints.active, true))
      .orderBy(asc(issuePoints.code));
    const typeRows = await tx
      .select()
      .from(issuePointDocumentTypes)
      .where(eq(issuePointDocumentTypes.active, true))
      .orderBy(asc(issuePointDocumentTypes.documentType));
    return {
      profile: {
        ruc: tenant!.ruc,
        legalName: tenant!.legalName,
        tradeName: tenant!.tradeName,
        mainAddress: tenant!.mainAddress,
        requiredAccounting: tenant!.requiredAccounting,
        specialTaxpayerResolution: tenant!.specialTaxpayerResolution,
        withholdingAgentResolution: tenant!.withholdingAgentResolution,
        taxRegime: tenant!.taxRegime,
      },
      branches: branchRows.map((branch) => ({
        id: branch.id,
        code: branch.code,
        name: branch.name,
        address: branch.address,
        issuePoints: pointRows
          .filter((point) => point.branchId === branch.id)
          .map((point) => ({
            id: point.id,
            code: point.code,
            canIssue: point.canIssue,
            documentTypes: typeRows
              .filter((row) => row.issuePointId === point.id)
              .map((row) => row.documentType),
          })),
      })),
    };
  });
}

// One settings change: system context, as it writes the company and its twin.
async function change<T>(
  ctx: ActorContext,
  db: Database,
  reason: string,
  fn: (tx: Tx['db'], pair: Pair) => Promise<T>,
): Promise<T> {
  requirePermission(ctx, 'organization.manage');
  return db.withSystem(reason, async ({ db: tx }) => fn(tx, await pairOf(tx, ctx.tenantId)));
}

export const updateCompanyProfile = (
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof companyProfileInput>,
) =>
  change(ctx, db, 'update the tax data of a company and its twin', async (tx, pair) => {
    const input = companyProfileInput.parse(raw);
    await tx
      .update(schema.tenants)
      .set({ ...input, updatedAt: sql`now()` })
      .where(inArray(schema.tenants.id, tenantsOf(pair)));
    await recordAudit(tx, {
      tenantId: pair.realTenantId,
      actorUserId: ctx.userId ?? null,
      action: 'organization.settings_changed',
      details: { taxRegime: input.taxRegime, requiredAccounting: input.requiredAccounting },
    });
  });

// Branch or issue point in the actor's tenant, by id; its codes find the twin's copy.
async function branchCodes(tx: Tx['db'], tenantId: string, branchId: string) {
  const [row] = await tx
    .select({ code: schema.branches.code })
    .from(schema.branches)
    .where(and(eq(schema.branches.tenantId, tenantId), eq(schema.branches.id, branchId)));
  if (!row) throw new DomainError('NOT_FOUND', 'Branch not found');
  return row.code;
}

async function pointCodes(tx: Tx['db'], tenantId: string, issuePointId: string) {
  const { branches, issuePoints } = schema;
  const [row] = await tx
    .select({ branchCode: branches.code, pointCode: issuePoints.code })
    .from(issuePoints)
    .innerJoin(branches, eq(branches.id, issuePoints.branchId))
    .where(and(eq(issuePoints.tenantId, tenantId), eq(issuePoints.id, issuePointId)));
  if (!row) throw new DomainError('NOT_FOUND', 'Issue point not found');
  return row;
}

async function pointIn(tx: Tx['db'], tenantId: string, branchCode: string, pointCode: string) {
  const { branches, issuePoints } = schema;
  const [row] = await tx
    .select({ id: issuePoints.id })
    .from(issuePoints)
    .innerJoin(branches, eq(branches.id, issuePoints.branchId))
    .where(
      and(
        eq(issuePoints.tenantId, tenantId),
        eq(branches.code, branchCode),
        eq(issuePoints.code, pointCode),
      ),
    );
  if (!row) throw new Error(`Issue point ${branchCode}-${pointCode} missing in ${tenantId}`);
  return row.id;
}

const isUniqueViolation = (error: unknown) => {
  const pgError = error instanceof Error && error.cause ? error.cause : error;
  return (
    typeof pgError === 'object' && pgError !== null && 'code' in pgError && pgError.code === '23505'
  );
};

// Within the plan's MAX_BRANCHES; its warehouse comes with it (FR-MD-4).
export async function createBranch(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof branchInput>,
): Promise<void> {
  const input = branchInput.parse(raw);
  try {
    await change(ctx, db, 'add a branch to a company and its twin', async (tx, pair) => {
      const [used] = await tx
        .select({ n: count() })
        .from(schema.branches)
        .where(
          and(eq(schema.branches.tenantId, pair.realTenantId), eq(schema.branches.active, true)),
        );
      requireWithinLimit(ctx.entitlements, 'MAX_BRANCHES', used!.n);
      for (const tenantId of tenantsOf(pair)) {
        const [branch] = await tx
          .insert(schema.branches)
          .values({ tenantId, ...input })
          .returning({ id: schema.branches.id });
        await tx
          .insert(schema.warehouses)
          .values({ tenantId, branchId: branch!.id, name: input.name });
      }
      await recordAudit(tx, {
        tenantId: pair.realTenantId,
        actorUserId: ctx.userId ?? null,
        action: 'branch.created',
        details: { branch: input.code, name: input.name },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError('CODE_TAKEN', 'That branch code is in use');
    throw error;
  }
}

// The address prints on every document of the branch (dirEstablecimiento, SRI rule 12).
export async function updateBranch(
  ctx: ActorContext,
  db: Database,
  input: { branchId: string; name: string; address: string },
): Promise<void> {
  const branchId = z.uuid().parse(input.branchId);
  const fields = branchInput.pick({ name: true, address: true }).parse(input);
  await change(ctx, db, 'update a branch of a company and its twin', async (tx, pair) => {
    const branchCode = await branchCodes(tx, ctx.tenantId, branchId);
    await tx
      .update(schema.branches)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(
        and(
          inArray(schema.branches.tenantId, tenantsOf(pair)),
          eq(schema.branches.code, branchCode),
        ),
      );
    await recordAudit(tx, {
      tenantId: pair.realTenantId,
      actorUserId: ctx.userId ?? null,
      action: 'branch.updated',
      details: { branch: branchCode, name: fields.name },
    });
  });
}

// Within MAX_ISSUE_POINTS_PER_BRANCH; it starts issuing facturas, as every plan allows.
export async function createIssuePoint(
  ctx: ActorContext,
  db: Database,
  input: { branchId: string; code: string },
): Promise<void> {
  const branchId = z.uuid().parse(input.branchId);
  const pointCode = code.parse(input.code);
  try {
    await change(ctx, db, 'add an issue point to a company and its twin', async (tx, pair) => {
      const branchCode = await branchCodes(tx, ctx.tenantId, branchId);
      for (const tenantId of tenantsOf(pair)) {
        const [branch] = await tx
          .select({ id: schema.branches.id })
          .from(schema.branches)
          .where(and(eq(schema.branches.tenantId, tenantId), eq(schema.branches.code, branchCode)));
        const [used] = await tx
          .select({ n: count() })
          .from(schema.issuePoints)
          .where(
            and(eq(schema.issuePoints.branchId, branch!.id), eq(schema.issuePoints.active, true)),
          );
        if (tenantId === pair.realTenantId)
          requireWithinLimit(ctx.entitlements, 'MAX_ISSUE_POINTS_PER_BRANCH', used!.n);
        const [point] = await tx
          .insert(schema.issuePoints)
          .values({ tenantId, branchId: branch!.id, code: pointCode })
          .returning({ id: schema.issuePoints.id });
        await enableType(tx, tenantId, point!.id, '01');
      }
      await recordAudit(tx, {
        tenantId: pair.realTenantId,
        actorUserId: ctx.userId ?? null,
        action: 'issue_point.created',
        details: { point: `${branchCode}-${pointCode}` },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new DomainError('CODE_TAKEN', 'That issue point code is in use');
    throw error;
  }
}

async function enableType(
  tx: Tx['db'],
  tenantId: string,
  issuePointId: string,
  documentType: string,
) {
  const { issuePointDocumentTypes, documentSequences } = schema;
  await tx
    .insert(issuePointDocumentTypes)
    .values({ tenantId, issuePointId, documentType: documentType as '01' })
    .onConflictDoUpdate({
      target: [issuePointDocumentTypes.issuePointId, issuePointDocumentTypes.documentType],
      set: { active: true, updatedAt: sql`now()` },
    });
  // A sequence, once made, keeps its place even if the type is disabled and enabled again.
  await tx
    .insert(documentSequences)
    .values({ tenantId, issuePointId, documentType: documentType as '01' })
    .onConflictDoNothing();
}

// FR-PLAN-3: enabling needs the type's feature and a builder for it; disabling never does.
export async function setIssuePointDocumentType(
  ctx: ActorContext,
  db: Database,
  input: { issuePointId: string; documentType: string; enabled: boolean },
): Promise<void> {
  const issuePointId = z.uuid().parse(input.issuePointId);
  const documentType = z.enum(ISSUABLE_DOCUMENT_TYPES).parse(input.documentType);
  if (input.enabled) requireFeature(ctx, `DOC_TYPE_${documentType}`);
  await change(ctx, db, 'set the document types of an issue point', async (tx, pair) => {
    const codes = await pointCodes(tx, ctx.tenantId, issuePointId);
    for (const tenantId of tenantsOf(pair)) {
      const pointId = await pointIn(tx, tenantId, codes.branchCode, codes.pointCode);
      if (input.enabled) await enableType(tx, tenantId, pointId, documentType);
      else
        await tx
          .update(schema.issuePointDocumentTypes)
          .set({ active: false, updatedAt: sql`now()` })
          .where(
            and(
              eq(schema.issuePointDocumentTypes.issuePointId, pointId),
              eq(schema.issuePointDocumentTypes.documentType, documentType),
            ),
          );
    }
    await recordAudit(tx, {
      tenantId: pair.realTenantId,
      actorUserId: ctx.userId ?? null,
      action: 'issue_point.document_types_changed',
      details: {
        point: `${codes.branchCode}-${codes.pointCode}`,
        documentType,
        enabled: input.enabled,
      },
    });
  });
}

// The pause switch checked before issuing (FR-DOC-2).
export async function setIssuePointPaused(
  ctx: ActorContext,
  db: Database,
  input: { issuePointId: string; canIssue: boolean },
): Promise<void> {
  const issuePointId = z.uuid().parse(input.issuePointId);
  await change(ctx, db, 'pause or resume an issue point', async (tx, pair) => {
    const codes = await pointCodes(tx, ctx.tenantId, issuePointId);
    for (const tenantId of tenantsOf(pair)) {
      const pointId = await pointIn(tx, tenantId, codes.branchCode, codes.pointCode);
      await tx
        .update(schema.issuePoints)
        .set({ canIssue: input.canIssue, updatedAt: sql`now()` })
        .where(eq(schema.issuePoints.id, pointId));
    }
    await recordAudit(tx, {
      tenantId: pair.realTenantId,
      actorUserId: ctx.userId ?? null,
      action: 'issue_point.paused_changed',
      details: { point: `${codes.branchCode}-${codes.pointCode}`, canIssue: input.canIssue },
    });
  });
}

export const startingSequentialInput = z.object({
  branchCode: code,
  pointCode: code,
  documentType: z.enum(ISSUABLE_DOCUMENT_TYPES),
  // The next number to issue: one more than the last one from the previous provider.
  next: z.number().int().min(1).max(999_999_999),
});

// FR-ONB-5: set once, at go-live, before the real company has issued anything. Only the
// real company's counters: the twin keeps counting its test documents.
export async function setStartingSequentials(
  tx: Tx['db'],
  realTenantId: string,
  raw: z.input<typeof startingSequentialInput>[],
): Promise<string[]> {
  const entries = z.array(startingSequentialInput).max(500).parse(raw);
  const set: string[] = [];
  for (const entry of entries) {
    if (entry.next === 1) continue;
    const pointId = await pointIn(tx, realTenantId, entry.branchCode, entry.pointCode);
    const updated = await tx
      .update(schema.documentSequences)
      .set({ nextValue: entry.next, updatedAt: sql`now()` })
      .where(
        and(
          eq(schema.documentSequences.issuePointId, pointId),
          eq(schema.documentSequences.documentType, entry.documentType),
          sql`${schema.documentSequences.nextValue} <= ${entry.next}`,
        ),
      )
      .returning({ id: schema.documentSequences.id });
    if (updated.length === 0)
      throw new DomainError('SEQUENCE_BACKWARD', 'A sequential can only move forward');
    set.push(`${entry.branchCode}-${entry.pointCode} ${entry.documentType}: ${entry.next}`);
  }
  return set;
}
