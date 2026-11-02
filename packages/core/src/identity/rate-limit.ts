import { createHash } from 'node:crypto';
import { and, count, eq, gte, lt, schema, type IdentityDb } from '@comprobify/db';
import { DomainError } from '../kernel';

// One limit per abuse vector, never shared (Appendix B, lesson 15). Stored in
// Postgres so every web instance sees the same counts.
export const RATE_LIMITS = {
  'sign-in:email': { limit: 5, windowSeconds: 15 * 60 },
  'sign-in:ip': { limit: 30, windowSeconds: 15 * 60 },
  'sign-up:ip': { limit: 5, windowSeconds: 60 * 60 },
  'password-reset:email': { limit: 3, windowSeconds: 60 * 60 },
  'password-reset:ip': { limit: 10, windowSeconds: 60 * 60 },
  'verification:email': { limit: 5, windowSeconds: 60 * 60 },
  'verification:ip': { limit: 20, windowSeconds: 60 * 60 },
  // Per organization: invitations send email to addresses the inviter chooses.
  'invitation:tenant': { limit: 30, windowSeconds: 60 * 60 },
} as const;

export type RateLimitVector = keyof typeof RATE_LIMITS;

export type RateLimiter = {
  // Throws RATE_LIMITED when the vector is over its limit for this key.
  check: (vector: RateLimitVector, key: string) => Promise<void>;
  hit: (vector: RateLimitVector, key: string) => Promise<void>;
  // check, then count this attempt.
  consume: (vector: RateLimitVector, key: string) => Promise<void>;
  prune: (olderThan: Date) => Promise<number>;
};

// Hashed so no email or IP address is stored.
const hashKey = (vector: string, key: string): string =>
  createHash('sha256').update(`${vector}:${key.trim().toLowerCase()}`).digest('hex');

// Fixed window, not atomic: a burst can overshoot by a few, which is fine for abuse control.
export function createRateLimiter(db: IdentityDb, now: () => Date): RateLimiter {
  const { rateLimitHits } = schema;

  const check: RateLimiter['check'] = async (vector, key) => {
    const { limit, windowSeconds } = RATE_LIMITS[vector];
    const since = new Date(now().getTime() - windowSeconds * 1000);
    const [row] = await db
      .select({ used: count() })
      .from(rateLimitHits)
      .where(
        and(
          eq(rateLimitHits.vector, vector),
          eq(rateLimitHits.keyHash, hashKey(vector, key)),
          gte(rateLimitHits.createdAt, since),
        ),
      );
    if ((row?.used ?? 0) >= limit) {
      throw new DomainError('RATE_LIMITED', 'Too many attempts', {
        retryAfterSeconds: windowSeconds,
      });
    }
  };

  const hit: RateLimiter['hit'] = async (vector, key) => {
    await db
      .insert(rateLimitHits)
      .values({ vector, keyHash: hashKey(vector, key), createdAt: now() });
  };

  return {
    check,
    hit,
    consume: async (vector, key) => {
      await check(vector, key);
      await hit(vector, key);
    },
    prune: async (olderThan) => {
      const deleted = await db
        .delete(rateLimitHits)
        .where(lt(rateLimitHits.createdAt, olderThan))
        .returning({ id: rateLimitHits.id });
      return deleted.length;
    },
  };
}
