import { and, eq, gte, lt, schema, type IdentityDb } from '@comprobify/db';
import { APIError } from 'better-auth/api';
import { z } from 'zod';
import { emailLocale } from '../email';
import { DomainError, type Clock } from '../kernel';
import type { Auth } from './auth';
import type { RateLimiter } from './rate-limit';
import { DEFAULT_IDLE_TIMEOUT_MINUTES, isIdle } from './session-activity';

const email = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());
const password = z.string().min(10).max(128);
const token = z.string().min(1).max(512);

export const signUpInput = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  password,
  locale: emailLocale,
});
export const signInInput = z.object({ email, password: z.string().min(1).max(128) });
export const emailInput = z.object({ email });
export const resetPasswordInput = z.object({ token, password });
export const verifyEmailInput = z.object({ token });

// Where the request came from. Headers carry the session cookie for Better Auth.
// ip is null when no proxy reported one, as in local development; per-IP limits
// then don't apply, and per-email limits still do.
export type RequestMeta = { ip: string | null; headers: Headers };

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  locale: 'es' | 'en';
  isSuperAdmin: boolean;
};

export type SessionState =
  | {
      status: 'active';
      user: SessionUser;
      sessionId: string;
      expiresAt: Date;
      // Set by the organization switcher; null until one is chosen (ADR-010).
      activeTenantId: string | null;
    }
  | { status: 'idle' }
  | { status: 'none' };

// Better Auth's codes, mapped to stable ones (NFR-ARCH-6). Unknown errors pass through.
const CODES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  USER_ALREADY_EXISTS: 'EMAIL_TAKEN',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'EMAIL_TAKEN',
  PASSWORD_TOO_SHORT: 'WEAK_PASSWORD',
  PASSWORD_TOO_LONG: 'WEAK_PASSWORD',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'INVALID_TOKEN',
};

async function mapAuthErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const code = error instanceof APIError ? CODES[String(error.body?.code)] : undefined;
    if (code) throw new DomainError(code, error instanceof Error ? error.message : code);
    throw error;
  }
}

// How often a still-active session's last_activity_at is written.
const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

export type IdentityOptions = {
  auth: Auth;
  db: IdentityDb;
  rateLimiter: RateLimiter;
  clock: Clock;
};

export function createIdentity({ auth, db, rateLimiter, clock }: IdentityOptions) {
  const { sessions } = schema;

  return {
    async signUp(raw: z.input<typeof signUpInput>, meta: RequestMeta): Promise<void> {
      const input = signUpInput.parse(raw);
      if (meta.ip) await rateLimiter.consume('sign-up:ip', meta.ip);
      await mapAuthErrors(() => auth.api.signUpEmail({ body: input, headers: meta.headers }));
    },

    // Only failures count, so a user signing in often is never locked out.
    async signIn(raw: z.input<typeof signInInput>, meta: RequestMeta): Promise<void> {
      const input = signInInput.parse(raw);
      await rateLimiter.check('sign-in:email', input.email);
      if (meta.ip) await rateLimiter.check('sign-in:ip', meta.ip);
      try {
        await mapAuthErrors(() => auth.api.signInEmail({ body: input, headers: meta.headers }));
      } catch (error) {
        await rateLimiter.hit('sign-in:email', input.email);
        if (meta.ip) await rateLimiter.hit('sign-in:ip', meta.ip);
        throw error;
      }
    },

    async signOut(meta: RequestMeta): Promise<void> {
      await auth.api.signOut({ headers: meta.headers });
    },

    // FR-USR-2: every session of this user, on every device.
    async signOutEverywhere(meta: RequestMeta): Promise<void> {
      await auth.api.revokeSessions({ headers: meta.headers });
      await auth.api.signOut({ headers: meta.headers });
    },

    // Called by our POST only; the emailed link's GET never consumes (FR-ONB-1).
    async verifyEmail(raw: z.input<typeof verifyEmailInput>, meta: RequestMeta): Promise<void> {
      const { token } = verifyEmailInput.parse(raw);
      if (meta.ip) await rateLimiter.consume('verification:ip', meta.ip);
      await mapAuthErrors(() => auth.api.verifyEmail({ query: { token }, headers: meta.headers }));
    },

    async resendVerification(raw: z.input<typeof emailInput>, meta: RequestMeta): Promise<void> {
      const input = emailInput.parse(raw);
      await rateLimiter.consume('verification:email', input.email);
      if (meta.ip) await rateLimiter.consume('verification:ip', meta.ip);
      await mapAuthErrors(() =>
        auth.api.sendVerificationEmail({ body: { email: input.email }, headers: meta.headers }),
      );
    },

    // Same answer whether or not the account exists.
    async requestPasswordReset(raw: z.input<typeof emailInput>, meta: RequestMeta): Promise<void> {
      const input = emailInput.parse(raw);
      await rateLimiter.consume('password-reset:email', input.email);
      if (meta.ip) await rateLimiter.consume('password-reset:ip', meta.ip);
      await mapAuthErrors(() =>
        auth.api.requestPasswordReset({ body: { email: input.email }, headers: meta.headers }),
      );
    },

    async resetPassword(raw: z.input<typeof resetPasswordInput>, meta: RequestMeta): Promise<void> {
      const input = resetPasswordInput.parse(raw);
      if (meta.ip) await rateLimiter.consume('password-reset:ip', meta.ip);
      await mapAuthErrors(() =>
        auth.api.resetPassword({
          body: { token: input.token, newPassword: input.password },
          headers: meta.headers,
        }),
      );
    },

    // Reading the session never extends it. An idle session is deleted here, so
    // it can't come back; the stale cookie then matches nothing.
    async currentSession(
      headers: Headers,
      idleMinutes = DEFAULT_IDLE_TIMEOUT_MINUTES,
    ): Promise<SessionState> {
      const found = await auth.api.getSession({ headers });
      if (!found) return { status: 'none' };
      const lastActivityAt = new Date(found.session.lastActivityAt ?? found.session.createdAt);
      if (isIdle(lastActivityAt, idleMinutes, clock.now())) {
        await db.delete(sessions).where(eq(sessions.id, found.session.id));
        return { status: 'idle' };
      }
      const { id, name, email, locale, isSuperAdmin } = found.user;
      return {
        status: 'active',
        sessionId: found.session.id,
        expiresAt: new Date(found.session.expiresAt),
        activeTenantId:
          typeof found.session.activeTenantId === 'string' ? found.session.activeTenantId : null,
        user: {
          id,
          name,
          email,
          locale: locale === 'en' ? 'en' : 'es',
          isSuperAdmin: isSuperAdmin === true,
        },
      };
    },

    // Called only from real input in the browser, never from page loads or polling.
    async recordActivity(
      headers: Headers,
      idleMinutes = DEFAULT_IDLE_TIMEOUT_MINUTES,
    ): Promise<void> {
      const found = await auth.api.getSession({ headers });
      if (!found) return;
      const now = clock.now();
      const stillLive = new Date(now.getTime() - idleMinutes * 60_000);
      const writtenRecently = new Date(now.getTime() - ACTIVITY_WRITE_INTERVAL_MS);
      await db
        .update(sessions)
        .set({ lastActivityAt: now })
        .where(
          and(
            eq(sessions.id, found.session.id),
            gte(sessions.lastActivityAt, stillLive),
            lt(sessions.lastActivityAt, writtenRecently),
          ),
        );
    },
  };
}

export type Identity = ReturnType<typeof createIdentity>;

// Called by tenancy after it checked the membership; the session belongs to identity.
export async function setActiveTenant(
  db: IdentityDb,
  input: { sessionId: string; userId: string; tenantId: string },
): Promise<void> {
  const { sessions } = schema;
  await db
    .update(sessions)
    .set({ activeTenantId: input.tenantId })
    .where(and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)));
}

// Daily, from the identity.prune job: expired sessions and tokens, old rate-limit hits.
export async function pruneIdentityTables(
  db: IdentityDb,
  rateLimiter: RateLimiter,
  now: Date,
): Promise<{ rateLimitHits: number; sessions: number; verifications: number }> {
  const { sessions, verifications } = schema;
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const expiredSessions = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, dayAgo))
    .returning({ id: sessions.id });
  const expiredTokens = await db
    .delete(verifications)
    .where(lt(verifications.expiresAt, dayAgo))
    .returning({ id: verifications.id });
  return {
    rateLimitHits: await rateLimiter.prune(dayAgo),
    sessions: expiredSessions.length,
    verifications: expiredTokens.length,
  };
}
