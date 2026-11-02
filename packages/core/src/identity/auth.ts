import { schema, type IdentityDb } from '@comprobify/db';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import type { EmailLocale } from '../email';
import { SESSION_LIFETIME_SECONDS } from './session-activity';

export type AuthEmails = {
  // Both receive our page's URL, never Better Auth's own route (ADR-009).
  verification: (to: string, locale: EmailLocale, token: string) => Promise<void>;
  passwordReset: (to: string, locale: EmailLocale, token: string) => Promise<void>;
};

export type AuthOptions = {
  db: IdentityDb;
  secret: string;
  appUrl: string;
  emails: AuthEmails;
  // nextCookies() from the web app, so core stays framework-free.
  plugins?: BetterAuthPlugin[];
};

// Better Auth types the callback user without our extra fields.
const localeOf = (user: object): EmailLocale =>
  'locale' in user && user.locale === 'en' ? 'en' : 'es';

export function createAuth(options: AuthOptions) {
  const { db, secret, appUrl, emails, plugins = [] } = options;
  return betterAuth({
    secret,
    baseURL: appUrl,
    database: drizzleAdapter(db, {
      provider: 'pg',
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
        twoFactors: schema.twoFactors,
      },
    }),
    // uuidv7() in the database (PRD section 8). No HTTP routes are mounted,
    // so Better Auth's own rate limiter would never run.
    advanced: { database: { generateId: false }, cookiePrefix: 'comprobify' },
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    user: {
      additionalFields: {
        locale: { type: 'string', required: false, defaultValue: 'es', input: true },
        isSuperAdmin: { type: 'boolean', required: false, defaultValue: false, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, token }) =>
        emails.passwordReset(user.email, localeOf(user), token),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 24 * 60 * 60,
      sendVerificationEmail: ({ user, token }) =>
        emails.verification(user.email, localeOf(user), token),
    },
    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      // Only real activity extends a session, through last_activity_at (FR-USR-2).
      disableSessionRefresh: true,
      additionalFields: {
        lastActivityAt: { type: 'date', required: false, input: false },
        activeTenantId: { type: 'string', required: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: (session) =>
            Promise.resolve({ data: { ...session, lastActivityAt: new Date() } }),
        },
      },
    },
    // TOTP only (FR-USR-3). Its lockout, 10 wrong codes then 15 minutes, applies to
    // server calls too. No trusted devices: every sign-in asks for the code.
    plugins: [twoFactor({ issuer: 'Comprobify' }), ...plugins],
  });
}

export type Auth = ReturnType<typeof createAuth>;
