import { and, eq, like, schema, type IdentityDb } from '@comprobify/db';

// Better Auth keeps each remembered device as a verification row named `trust-device-…` with the
// user's id as its value; the cookie alone is worth nothing without it (ADR-045). Signing out
// everywhere, a password reset, turning the code off and the super admin's sign-in remove them.
export async function forgetTrustedDevices(db: IdentityDb, userId: string): Promise<void> {
  const { verifications } = schema;
  await db
    .delete(verifications)
    .where(and(like(verifications.identifier, 'trust-device-%'), eq(verifications.value, userId)));
}
