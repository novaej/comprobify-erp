import { createHash } from 'node:crypto';
import { and, eq, gt, schema, sql, type IdentityDb } from '@comprobify/db';

// NIST SP 800-63B §5.1.4.2: a TOTP code is accepted once. Better Auth accepts a code during its own
// 30-second step and one on each side, so up to 90 seconds; a used code is remembered for longer.
// The row lives with the remembered devices in `verifications`, which the daily prune clears.
const REMEMBER_MS = 2 * 60 * 1000;

const identifierOf = (userId: string) => `totp-used:${userId}`;
// Hashed: a six-digit code is no secret once used, but the table holds nothing to replay.
const valueOf = (userId: string, code: string) =>
  createHash('sha256').update(`${userId}:${code}`).digest('hex');

// True the first time this user's code is seen in its window; false on a replay. The lock makes
// two submissions of one code at once take turns, so only the first wins.
export async function claimTotpCode(
  db: IdentityDb,
  userId: string,
  code: string,
  now: Date,
): Promise<boolean> {
  const { verifications } = schema;
  const identifier = identifierOf(userId);
  const value = valueOf(userId, code);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${identifier}))`);
    const [used] = await tx
      .select({ id: verifications.id })
      .from(verifications)
      .where(
        and(
          eq(verifications.identifier, identifier),
          eq(verifications.value, value),
          gt(verifications.expiresAt, now),
        ),
      );
    if (used) return false;
    await tx
      .insert(verifications)
      .values({ identifier, value, expiresAt: new Date(now.getTime() + REMEMBER_MS) });
    return true;
  });
}
