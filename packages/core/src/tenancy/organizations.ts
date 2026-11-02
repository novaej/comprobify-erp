import { and, eq, schema, type Database } from '@comprobify/db';
import { z } from 'zod';
import { setActiveTenant } from '../identity';
import { DomainError, type ActorContext, type Clock } from '../kernel';
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
});

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
): Promise<CreatedOrganization> {
  const input = createOrganizationInput.parse(raw);
  try {
    return await db.withSystem('create organization and its test twin', async ({ db: tx }) => {
      const { tenants, branches, issuePoints, warehouses, memberships } = schema;
      const profile = {
        ruc: input.ruc,
        legalName: input.legalName,
        tradeName: input.tradeName,
        mainAddress: input.mainAddress,
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
        await tx
          .insert(issuePoints)
          .values({ tenantId: tenant.id, branchId: branch!.id, code: input.issuePointCode });
        await tx
          .insert(warehouses)
          .values({ tenantId: tenant.id, branchId: branch!.id, name: input.branch.name });
        await tx
          .insert(memberships)
          .values({ tenantId: tenant.id, userId: input.ownerUserId, role: 'OWNER' });
      }
      return { realTenantId: real!.id, twinTenantId: twin!.id };
    });
  } catch (error) {
    if (isUniqueViolation(error, 'tenants_ruc_mode_unique')) {
      throw new DomainError('RUC_TAKEN', 'An organization with this RUC already exists');
    }
    throw error;
  }
}

export type OrganizationEntry = {
  realTenantId: string;
  twinTenantId: string | null;
  ruc: string;
  name: string;
  role: Role;
  live: boolean;
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
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  });
}

// The actor context for one request, read in that tenant's own context.
export async function resolveActor(
  db: Database,
  input: { userId: string; tenantId: string; clock: Clock },
): Promise<ActorContext> {
  return db.withTenant({ tenantId: input.tenantId }, async ({ db: tx }) => {
    const { tenants, memberships } = schema;
    const [row] = await tx
      .select({ mode: tenants.mode, role: memberships.role })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.userId, input.userId), eq(memberships.active, true)));
    if (!row) throw new DomainError('NOT_A_MEMBER', 'Not a member of this organization');
    return {
      tenantId: input.tenantId,
      tenantMode: row.mode,
      userId: input.userId,
      permissions: permissionsFor(row.role),
      // Issue-point restrictions arrive with user management (FR-ROLE-2).
      issuePointIds: null,
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

// Core enforces permissions; pages only hide what this would refuse (FR-ROLE-3).
export function requirePermission(ctx: ActorContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) {
    throw new DomainError('FORBIDDEN', `Missing permission ${permission}`, { permission });
  }
}
