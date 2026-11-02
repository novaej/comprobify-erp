import { createHash, randomBytes } from 'node:crypto';
import { and, ASSIGNABLE_ROLES, eq, schema, sql, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import type { RateLimiter } from '../identity';
import type { Jobs } from '../jobs';
import { DomainError, type ActorContext, type Clock } from '../kernel';
import { requirePermission } from './organizations';
import type { Role } from './roles';

const INVITATION_DAYS = 7;
const assignableRole = z.enum(ASSIGNABLE_ROLES);
const email = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

type Pair = { realTenantId: string; twinTenantId: string | null; name: string };

// The organization and its twin, from either one. System context only.
async function pairOf(tx: Tx['db'], tenantId: string): Promise<Pair> {
  const { tenants } = schema;
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw new DomainError('NOT_FOUND', 'Organization not found');
  const realTenantId = tenant.twinOf ?? tenant.id;
  const [real] =
    tenant.twinOf === null
      ? [tenant]
      : await tx.select().from(tenants).where(eq(tenants.id, realTenantId));
  const [twin] = await tx
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.twinOf, realTenantId));
  return { realTenantId, twinTenantId: twin?.id ?? null, name: real!.tradeName ?? real!.legalName };
}

// ADR-010: every membership change lands in the organization and its twin together.
async function writeMembership(
  tx: Tx['db'],
  pair: Pair,
  userId: string,
  change: { role?: Role; active: boolean },
): Promise<void> {
  const { memberships } = schema;
  for (const tenantId of [pair.realTenantId, pair.twinTenantId]) {
    if (!tenantId) continue;
    await tx
      .insert(memberships)
      .values({ tenantId, userId, role: change.role ?? 'VIEWER', active: change.active })
      .onConflictDoUpdate({
        target: [memberships.tenantId, memberships.userId],
        set: { ...(change.role ? { role: change.role } : {}), active: change.active },
      });
  }
}

async function targetMembership(tx: Tx['db'], tenantId: string, userId: string) {
  const { memberships } = schema;
  const [row] = await tx
    .select()
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
  return row;
}

// Neither the owner nor yourself: ownership is transferred, and an admin can't lock themselves out.
function guardTarget(
  ctx: ActorContext,
  membership: { role: Role; active: boolean } | undefined,
  userId: string,
) {
  if (!membership?.active)
    throw new DomainError('NOT_A_MEMBER', 'Not a member of this organization');
  if (membership.role === 'OWNER')
    throw new DomainError('OWNER_PROTECTED', 'The owner can only be changed by a transfer');
  if (userId === ctx.userId)
    throw new DomainError('CANNOT_CHANGE_SELF', 'You cannot change your own membership');
}

export type MemberRow = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  // The member's allowed points as branch-point codes; empty means all of them.
  issuePoints: string[];
};
export type InvitationRow = { id: string; email: string; role: Role; expiresAt: Date };

// The users page (FR-USR-1). Read in the real organization, which the actor belongs to
// through the mirrored membership.
export async function listMembers(
  ctx: ActorContext,
  db: Database,
): Promise<{ members: MemberRow[]; invitations: InvitationRow[] }> {
  requirePermission(ctx, 'users.read');
  const realTenantId = await db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const [tenant] = await tx
      .select({ id: schema.tenants.id, twinOf: schema.tenants.twinOf })
      .from(schema.tenants);
    return tenant?.twinOf ?? tenant!.id;
  });
  return db.withTenant({ tenantId: realTenantId }, async ({ db: tx }) => {
    const { memberships, users, invitations, issuePointAccess } = schema;
    const rows = await tx
      .select({
        userId: memberships.userId,
        name: users.name,
        email: users.email,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.active, true))
      .orderBy(users.name);
    const access = await tx
      .select({
        userId: issuePointAccess.userId,
        code: sql<string>`${schema.branches.code} || '-' || ${schema.issuePoints.code}`,
      })
      .from(issuePointAccess)
      .innerJoin(schema.issuePoints, eq(schema.issuePoints.id, issuePointAccess.issuePointId))
      .innerJoin(schema.branches, eq(schema.branches.id, schema.issuePoints.branchId))
      .where(eq(issuePointAccess.active, true));
    const members = rows.map((row) => ({
      ...row,
      issuePoints: access.filter((entry) => entry.userId === row.userId).map((entry) => entry.code),
    }));
    const pending = await tx
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .where(
        sql`${invitations.acceptedAt} IS NULL AND ${invitations.revokedAt} IS NULL AND ${invitations.expiresAt} > ${ctx.clock.now()}`,
      )
      .orderBy(invitations.createdAt);
    return { members, invitations: pending };
  });
}

export const inviteInput = z.object({ email, role: assignableRole, locale: z.enum(['es', 'en']) });

export type InviteDeps = { jobs: Jobs; appUrl: string; rateLimiter: RateLimiter };

// FR-USR-1. A fresh invitation replaces an open one for the same email. The email is
// enqueued in the same transaction (CLAUDE.md rule 10).
export async function inviteMember(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof inviteInput>,
  deps: InviteDeps,
): Promise<void> {
  requirePermission(ctx, 'users.manage');
  const input = inviteInput.parse(raw);
  await deps.rateLimiter.consume('invitation:tenant', ctx.tenantId);
  const token = randomBytes(32).toString('base64url');
  const now = ctx.clock.now();

  await db.withSystem('invite a member to an organization and its twin', async (tx) => {
    const pair = await pairOf(tx.db, ctx.tenantId);
    const { invitations, memberships, users } = schema;
    const [existing] = await tx.db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.tenantId, pair.realTenantId),
          eq(users.email, input.email),
          eq(memberships.active, true),
        ),
      );
    if (existing) throw new DomainError('ALREADY_MEMBER', 'This person is already a member');

    await tx.db
      .update(invitations)
      .set({ revokedAt: now })
      .where(
        sql`${invitations.tenantId} = ${pair.realTenantId} AND ${invitations.email} = ${input.email} AND ${invitations.acceptedAt} IS NULL AND ${invitations.revokedAt} IS NULL`,
      );
    await tx.db.insert(invitations).values({
      tenantId: pair.realTenantId,
      email: input.email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedBy: ctx.userId!,
      expiresAt: new Date(now.getTime() + INVITATION_DAYS * 86_400_000),
    });
    await deps.jobs.enqueue(tx, 'email.send', {
      to: input.email,
      locale: input.locale,
      template: 'invitation',
      params: {
        url: `${deps.appUrl}/${input.locale}/invite?token=${token}`,
        organization: pair.name,
      },
    });
  });
}

export async function revokeInvitation(
  ctx: ActorContext,
  db: Database,
  invitationId: string,
): Promise<void> {
  requirePermission(ctx, 'users.manage');
  await db.withSystem('revoke an invitation', async ({ db: tx }) => {
    const pair = await pairOf(tx, ctx.tenantId);
    const { invitations } = schema;
    await tx
      .update(invitations)
      .set({ revokedAt: ctx.clock.now() })
      .where(and(eq(invitations.id, invitationId), eq(invitations.tenantId, pair.realTenantId)));
  });
}

export async function changeRole(
  ctx: ActorContext,
  db: Database,
  raw: { userId: string; role: string },
): Promise<void> {
  requirePermission(ctx, 'users.manage');
  const role = assignableRole.parse(raw.role);
  await db.withSystem(
    'change a member role in an organization and its twin',
    async ({ db: tx }) => {
      const pair = await pairOf(tx, ctx.tenantId);
      guardTarget(ctx, await targetMembership(tx, pair.realTenantId, raw.userId), raw.userId);
      await writeMembership(tx, pair, raw.userId, { role, active: true });
    },
  );
}

// Soft removal (CLAUDE.md rule 12): the membership stays, inactive.
export async function removeMember(ctx: ActorContext, db: Database, userId: string): Promise<void> {
  requirePermission(ctx, 'users.manage');
  await db.withSystem('remove a member from an organization and its twin', async ({ db: tx }) => {
    const pair = await pairOf(tx, ctx.tenantId);
    guardTarget(ctx, await targetMembership(tx, pair.realTenantId, userId), userId);
    await writeMembership(tx, pair, userId, { active: false });
  });
}

export type IssuePointOption = { branchCode: string; pointCode: string; branchName: string };

export async function listIssuePoints(
  ctx: ActorContext,
  db: Database,
): Promise<IssuePointOption[]> {
  requirePermission(ctx, 'users.read');
  return db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx
      .select({
        branchCode: schema.branches.code,
        pointCode: schema.issuePoints.code,
        branchName: schema.branches.name,
      })
      .from(schema.issuePoints)
      .innerJoin(schema.branches, eq(schema.branches.id, schema.issuePoints.branchId))
      .where(eq(schema.issuePoints.active, true))
      .orderBy(schema.branches.code, schema.issuePoints.code),
  );
}

const pointCode = z.object({
  branchCode: z.string().regex(/^[0-9]{3}$/),
  pointCode: z.string().regex(/^[0-9]{3}$/),
});

// FR-ROLE-2. An empty list removes the restriction. Mirrored in the twin by codes,
// since its issue points have their own ids.
export async function setIssuePointAccess(
  ctx: ActorContext,
  db: Database,
  raw: { userId: string; points: z.input<typeof pointCode>[] },
): Promise<void> {
  requirePermission(ctx, 'users.manage');
  const points = z.array(pointCode).max(500).parse(raw.points);
  await db.withSystem(
    'restrict a member to issue points in an organization and its twin',
    async ({ db: tx }) => {
      const pair = await pairOf(tx, ctx.tenantId);
      guardTarget(ctx, await targetMembership(tx, pair.realTenantId, raw.userId), raw.userId);
      const { issuePointAccess, issuePoints, branches } = schema;
      const wanted = new Set(points.map((point) => `${point.branchCode}-${point.pointCode}`));

      for (const tenantId of [pair.realTenantId, pair.twinTenantId]) {
        if (!tenantId) continue;
        const available = await tx
          .select({
            id: issuePoints.id,
            code: sql<string>`${branches.code} || '-' || ${issuePoints.code}`,
          })
          .from(issuePoints)
          .innerJoin(branches, eq(branches.id, issuePoints.branchId))
          .where(eq(issuePoints.tenantId, tenantId));
        if (
          tenantId === pair.realTenantId &&
          [...wanted].some((code) => !available.some((point) => point.code === code))
        ) {
          throw new DomainError('UNKNOWN_ISSUE_POINT', 'An issue point does not exist');
        }
        await tx
          .update(issuePointAccess)
          .set({ active: false })
          .where(
            and(eq(issuePointAccess.tenantId, tenantId), eq(issuePointAccess.userId, raw.userId)),
          );
        for (const point of available.filter((candidate) => wanted.has(candidate.code))) {
          await tx
            .insert(issuePointAccess)
            .values({ tenantId, userId: raw.userId, issuePointId: point.id, active: true })
            .onConflictDoUpdate({
              target: [
                issuePointAccess.tenantId,
                issuePointAccess.userId,
                issuePointAccess.issuePointId,
              ],
              set: { active: true },
            });
        }
      }
    },
  );
}

export type InvitationView = {
  email: string;
  role: Role;
  organization: string;
  state: 'pending' | 'accepted' | 'revoked' | 'expired';
  // Whether to offer sign-in or a set-password form.
  hasAccount: boolean;
};

// GET: shows the invitation without using it up (Appendix B, lesson 5). The token is
// all a visitor has, so the lookup crosses tenants in system context.
export async function getInvitation(
  db: Database,
  token: string,
  clock: Clock,
): Promise<InvitationView | null> {
  return db.withSystem('look up an invitation by its token', async ({ db: tx }) => {
    const { invitations } = schema;
    const [row] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, hashToken(token)));
    if (!row) return null;
    const pair = await pairOf(tx, row.tenantId);
    const state = row.acceptedAt
      ? 'accepted'
      : row.revokedAt
        ? 'revoked'
        : row.expiresAt <= clock.now()
          ? 'expired'
          : 'pending';
    const [account] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, row.email));
    return {
      email: row.email,
      role: row.role,
      organization: pair.name,
      state,
      hasAccount: Boolean(account),
    };
  });
}

// POST: the signed-in user, whose email must be the invited one, joins the
// organization and its twin. Returns the organization to open.
export async function acceptInvitation(
  db: Database,
  input: { token: string; userId: string; userEmail: string },
  clock: Clock,
): Promise<{ realTenantId: string; twinTenantId: string | null }> {
  return db.withSystem('accept an invitation', async ({ db: tx }) => {
    const { invitations } = schema;
    const [row] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, hashToken(input.token)))
      .for('update');
    const now = clock.now();
    if (!row || row.acceptedAt || row.revokedAt || row.expiresAt <= now) {
      throw new DomainError('INVITATION_INVALID', 'This invitation is no longer valid');
    }
    if (row.email !== input.userEmail.toLowerCase()) {
      throw new DomainError('INVITATION_OTHER_EMAIL', 'This invitation is for another email');
    }
    const pair = await pairOf(tx, row.tenantId);
    await writeMembership(tx, pair, input.userId, { role: row.role, active: true });
    await tx.update(invitations).set({ acceptedAt: now }).where(eq(invitations.id, row.id));
    return { realTenantId: pair.realTenantId, twinTenantId: pair.twinTenantId };
  });
}
