import { and, eq, schema, TAX_REGIMES, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { loadEntitlements, startDefaultSubscriptions, subscriptionState } from '../entitlements';
import { setActiveTenant } from '../identity';
import { DomainError, ecuadorDate, systemClock, type ActorContext, type Clock } from '../kernel';
import type { Logo } from './logo';
import { permissionsFor, type Role } from './roles';

const code = z.string().regex(/^[0-9]{3}$/);

export const createOrganizationInput = z.object({
  ownerUserId: z.uuid(),
  ruc: z.string().regex(/^[0-9]{13}$/),
  legalName: z.string().trim().min(1).max(300),
  tradeName: z.string().trim().min(1).max(300).nullable(),
  mainAddress: z.string().trim().min(1).max(300),
  branch: z.object({
    code,
    name: z.string().trim().min(1).max(120),
    // Defaults to the main address (FR-ONB-2).
    address: z.string().trim().min(1).max(300).nullable(),
  }),
  issuePointCode: code,
  requiredAccounting: z.boolean().default(false),
  // Asked at onboarding so a RIMPE company's first invoice carries its legend.
  taxRegime: z.enum(TAX_REGIMES).default('GENERAL'),
});

// Prepared by onboardOrganization: already parsed, matched and encrypted.
export type StoredCertificate = {
  encryptedPrivateKey: string;
  certificatePem: string;
  fingerprint: string;
  subjectName: string;
  issuerName: string;
  notBefore: Date;
  notAfter: Date;
};

export type CreatedOrganization = { realTenantId: string; twinTenantId: string };

// Drizzle wraps the driver's error, which carries the SQLSTATE and constraint.
const isUniqueViolation = (error: unknown, constraint: string): boolean => {
  const pgError = error instanceof Error && error.cause ? error.cause : error;
  return (
    typeof pgError === 'object' &&
    pgError !== null &&
    'code' in pgError &&
    pgError.code === '23505' &&
    'constraint' in pgError &&
    pgError.constraint === constraint
  );
};

// FR-ONB-4: the real organization and its test twin, with the same branch,
// issue point and warehouse, and the owner's membership mirrored (ADR-010).
// System context, because it writes two tenants in one transaction.
export async function createOrganization(
  db: Database,
  raw: z.input<typeof createOrganizationInput>,
  extras: { certificate?: StoredCertificate; logo?: Logo; clock?: Clock } = {},
): Promise<CreatedOrganization> {
  const input = createOrganizationInput.parse(raw);
  try {
    return await db.withSystem('create organization and its test twin', async ({ db: tx }) => {
      const { tenants, branches, issuePoints, warehouses, memberships, certificates, tenantLogos } =
        schema;
      const profile = {
        ruc: input.ruc,
        legalName: input.legalName,
        tradeName: input.tradeName,
        mainAddress: input.mainAddress,
        requiredAccounting: input.requiredAccounting,
        taxRegime: input.taxRegime,
      };
      const [real] = await tx
        .insert(tenants)
        .values({ ...profile, mode: 'PRODUCTION' })
        .returning();
      const [twin] = await tx
        .insert(tenants)
        .values({ ...profile, mode: 'TEST', twinOf: real!.id })
        .returning();

      for (const tenant of [real!, twin!]) {
        const [branch] = await tx
          .insert(branches)
          .values({
            tenantId: tenant.id,
            code: input.branch.code,
            name: input.branch.name,
            address: input.branch.address ?? input.mainAddress,
          })
          .returning();
        const [point] = await tx
          .insert(issuePoints)
          .values({ tenantId: tenant.id, branchId: branch!.id, code: input.issuePointCode })
          .returning({ id: issuePoints.id });
        // Facturas from the start: the base module has DOC_TYPE_01 on every plan (FR-PLAN-3).
        await tx
          .insert(schema.issuePointDocumentTypes)
          .values({ tenantId: tenant.id, issuePointId: point!.id, documentType: '01' });
        await tx
          .insert(schema.documentSequences)
          .values({ tenantId: tenant.id, issuePointId: point!.id, documentType: '01' });
        await tx
          .insert(warehouses)
          .values({ tenantId: tenant.id, branchId: branch!.id, name: input.branch.name });
        await tx
          .insert(memberships)
          .values({ tenantId: tenant.id, userId: input.ownerUserId, role: 'OWNER' });
        // Stored on both: RLS forbids the twin reading the real organization's row (FR-ONB-3).
        if (extras.certificate) {
          await tx.insert(certificates).values({ tenantId: tenant.id, ...extras.certificate });
        }
        if (extras.logo)
          await tx.insert(tenantLogos).values({ tenantId: tenant.id, ...extras.logo });
        await recordAudit(tx, {
          tenantId: tenant.id,
          actorUserId: input.ownerUserId,
          action: 'organization.created',
          details: { ruc: input.ruc, mode: tenant.mode, taxRegime: input.taxRegime },
        });
        if (extras.certificate) {
          await recordAudit(tx, {
            tenantId: tenant.id,
            actorUserId: input.ownerUserId,
            action: 'certificate.uploaded',
            details: {
              fingerprint: extras.certificate.fingerprint,
              issuerName: extras.certificate.issuerName,
              notAfter: extras.certificate.notAfter.toISOString(),
            },
          });
        }
      }
      const created = { realTenantId: real!.id, twinTenantId: twin!.id };
      await startDefaultSubscriptions(
        tx,
        [created],
        ecuadorDate((extras.clock ?? systemClock).now()),
      );
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'tenants_ruc_mode_unique')) {
      throw new DomainError('RUC_TAKEN', 'An organization with this RUC already exists');
    }
    throw error;
  }
}

// The migrate step: every company created before plans existed starts on the
// default plan. Companies that already have one are left alone.
export async function assignDefaultPlans(db: Database): Promise<number> {
  return db.withSystem('put companies without a plan on the default plan', async ({ db: tx }) => {
    const { tenants } = schema;
    const twins = await tx
      .select({ realTenantId: tenants.twinOf, twinTenantId: tenants.id })
      .from(tenants)
      .where(eq(tenants.mode, 'TEST'));
    return startDefaultSubscriptions(
      tx,
      twins.map((twin) => ({ realTenantId: twin.realTenantId!, twinTenantId: twin.twinTenantId })),
      ecuadorDate(systemClock.now()),
    );
  });
}

export type OrganizationEntry = {
  realTenantId: string;
  twinTenantId: string | null;
  ruc: string;
  name: string;
  role: Role;
  live: boolean;
  // Members must use TOTP to work here (FR-USR-3).
  requireTwoFactor: boolean;
};

// FR-USR-5: one entry per real organization and its twin. User context (ADR-010).
export async function listOrganizations(
  db: Database,
  userId: string,
): Promise<OrganizationEntry[]> {
  return db.withUser(userId, async ({ db: tx }) => {
    const { tenants, memberships } = schema;
    const rows = await tx
      .select({
        id: tenants.id,
        ruc: tenants.ruc,
        legalName: tenants.legalName,
        tradeName: tenants.tradeName,
        mode: tenants.mode,
        twinOf: tenants.twinOf,
        liveAt: tenants.liveAt,
        requireTwoFactor: tenants.requireTwoFactor,
        role: memberships.role,
      })
      .from(tenants)
      .innerJoin(
        memberships,
        and(
          eq(memberships.tenantId, tenants.id),
          eq(memberships.userId, userId),
          eq(memberships.active, true),
        ),
      );

    const twins = new Map(rows.filter((row) => row.twinOf).map((row) => [row.twinOf!, row.id]));
    return rows
      .filter((row) => row.mode === 'PRODUCTION')
      .map((row) => ({
        realTenantId: row.id,
        twinTenantId: twins.get(row.id) ?? null,
        ruc: row.ruc,
        name: row.tradeName ?? row.legalName,
        role: row.role,
        live: row.liveAt !== null,
        requireTwoFactor: row.requireTwoFactor,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  });
}

// FR-ROLE-2: null means every issue point; core filters queries by the list.
async function restrictedIssuePoints(tx: Tx['db'], userId: string): Promise<string[] | null> {
  const { issuePointAccess } = schema;
  const rows = await tx
    .select({ id: issuePointAccess.issuePointId })
    .from(issuePointAccess)
    .where(and(eq(issuePointAccess.userId, userId), eq(issuePointAccess.active, true)));
  return rows.length > 0 ? rows.map((row) => row.id) : null;
}

// The actor context for one request, read in that tenant's own context.
export async function resolveActor(
  db: Database,
  input: { userId: string; tenantId: string; clock: Clock },
): Promise<ActorContext> {
  return db.withTenant({ tenantId: input.tenantId }, async ({ db: tx }) => {
    const { tenants, memberships } = schema;
    const [row] = await tx
      .select({ mode: tenants.mode, status: tenants.status, role: memberships.role })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.userId, input.userId), eq(memberships.active, true)));
    if (!row) throw new DomainError('NOT_A_MEMBER', 'Not a member of this organization');
    // Both are mirrored in the twin, so it is blocked with its company.
    const { status } = await subscriptionState(tx, input.tenantId, input.clock.now());
    return {
      tenantId: input.tenantId,
      tenantMode: row.mode,
      userId: input.userId,
      permissions: permissionsFor(row.role),
      issuePointIds: await restrictedIssuePoints(tx, input.userId),
      // FR-PLAN-4: once per request; the twin reads its own mirrored rows.
      entitlements: await loadEntitlements(tx, input.tenantId, input.clock.now()),
      standing:
        row.status === 'SUSPENDED' ? 'SUSPENDED' : status === 'PAST_DUE' ? 'PAST_DUE' : 'GOOD',
      clock: input.clock,
    };
  });
}

// FR-USR-5: the switcher. The membership is checked in user context, so a
// tenant the user doesn't belong to can't be chosen.
export async function switchOrganization(
  db: Database,
  input: { userId: string; sessionId: string; tenantId: string },
): Promise<void> {
  const member = await db.withUser(input.userId, async ({ db: tx }) => {
    const { memberships } = schema;
    const [row] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, input.tenantId),
          eq(memberships.userId, input.userId),
          eq(memberships.active, true),
        ),
      );
    return Boolean(row);
  });
  if (!member) throw new DomainError('NOT_A_MEMBER', 'Not a member of this organization');
  await setActiveTenant(db.identity, input);
}
