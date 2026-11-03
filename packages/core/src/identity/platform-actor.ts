import { eq, schema, type IdentityDb } from '@comprobify/db';
import { DomainError, type Clock, type PlatformActor } from '../kernel';

const superAdmin = async (identity: IdentityDb, userId: string) => {
  const [user] = await identity
    .select({ isSuperAdmin: schema.users.isSuperAdmin })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return user?.isSuperAdmin === true;
};

// ADR-010: the flag is checked in core, not only by the admin pages.
export async function resolvePlatformActor(
  identity: IdentityDb,
  input: { userId: string; clock: Clock },
): Promise<PlatformActor> {
  if (!(await superAdmin(identity, input.userId)))
    throw new DomainError('FORBIDDEN', 'Super admin only');
  return { userId: input.userId, isSuperAdmin: true, clock: input.clock };
}

// Each admin write rechecks, so a revoked flag stops an actor already built.
export async function assertSuperAdmin(identity: IdentityDb, actor: PlatformActor): Promise<void> {
  if (!(await superAdmin(identity, actor.userId)))
    throw new DomainError('FORBIDDEN', 'Super admin only');
}

// The operator script: the flag is never set from the app.
export async function setSuperAdmin(
  identity: IdentityDb,
  email: string,
  value: boolean,
): Promise<boolean> {
  const updated = await identity
    .update(schema.users)
    .set({ isSuperAdmin: value })
    .where(eq(schema.users.email, email.trim().toLowerCase()))
    .returning({ id: schema.users.id });
  return updated.length > 0;
}
