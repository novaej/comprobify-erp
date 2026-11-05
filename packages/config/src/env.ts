import { z } from 'zod';

const appEnv = z.enum(['local', 'staging', 'production']);
const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

const sharedShape = {
  APP_ENV: appEnv,
  LOG_LEVEL: logLevel.default('info'),
  // pretty needs pino-pretty, a dev dependency the image leaves out.
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
  BETTERSTACK_SOURCE_TOKEN: z.string().optional(),
  SENTRY_DSN: z.url().optional(),
};

const runtimeShape = {
  ...sharedShape,
  DATABASE_URL: postgresUrl,
  SRI_MOCK_MODE: flag.default(false),
};

// Mailgun is optional only locally, where emails are logged instead (ADR-009).
const mailShape = {
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  MAILGUN_REGION: z.enum(['us', 'eu']).default('us'),
  EMAIL_FROM: z.string().default('Comprobify <no-reply@comprobify.com>'),
};

function refuseMockInProduction(
  env: { APP_ENV: string; SRI_MOCK_MODE: boolean },
  ctx: z.RefinementCtx,
): void {
  if (env.APP_ENV === 'production' && env.SRI_MOCK_MODE) {
    ctx.addIssue({
      code: 'custom',
      path: ['SRI_MOCK_MODE'],
      message: 'must be false when APP_ENV is production',
    });
  }
}

function requireMailOutsideLocal(
  env: {
    APP_ENV: string;
    MAILGUN_API_KEY?: string | undefined;
    MAILGUN_DOMAIN?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (env.APP_ENV === 'local') return;
  for (const name of ['MAILGUN_API_KEY', 'MAILGUN_DOMAIN'] as const) {
    if (!env[name])
      ctx.addIssue({ code: 'custom', path: [name], message: 'is required outside local' });
  }
}

// AES-256-GCM key for each company's stored certificate private key (FR-ONB-3); it never
// signs. The worker decrypts a company's key with it for that company's re-issues (FR-DOC-6).
const certificateKey = z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters');

export const webEnvSchema = z
  .object({
    ...runtimeShape,
    APP_URL: z.url(),
    // Signs session cookies and tokens. Rotating it signs everyone out.
    AUTH_SECRET: z.string().min(32),
    CERT_ENCRYPTION_KEY: certificateKey,
    // Off until the owner approves the legal texts (docs/legal/review-notes.md).
    AGREEMENTS_ENABLED: flag.default(false),
    // The operator named in the legal texts; required once agreements are on.
    OPERATOR_NAME: z.string().optional(),
    OPERATOR_RUC: z
      .string()
      .regex(/^[0-9]{13}$/, 'must be 13 digits')
      .optional(),
    OPERATOR_ADDRESS: z.string().optional(),
    SUPPORT_EMAIL: z.email().optional(),
  })
  .superRefine((env, ctx) => {
    refuseMockInProduction(env, ctx);
    if (!env.AGREEMENTS_ENABLED) return;
    for (const name of [
      'OPERATOR_NAME',
      'OPERATOR_RUC',
      'OPERATOR_ADDRESS',
      'SUPPORT_EMAIL',
    ] as const) {
      if (!env[name])
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: 'is required when AGREEMENTS_ENABLED is true',
        });
    }
  });

// The worker talks to SRI (ADR-014). The URLs default, in core, to SRI's own.
const sriShape = {
  SRI_TEST_URL: z.url().optional(),
  SRI_PRODUCTION_URL: z.url().optional(),
  SRI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
};

export const workerEnvSchema = z
  .object({ ...runtimeShape, ...mailShape, ...sriShape, CERT_ENCRYPTION_KEY: certificateKey })
  .superRefine((env, ctx) => {
    refuseMockInProduction(env, ctx);
    requireMailOutsideLocal(env, ctx);
  });

export const migrateEnvSchema = z.object({
  ...sharedShape,
  MIGRATION_DATABASE_URL: postgresUrl,
});

// Tests truncate and probe freely, so they can only run on a *_test database.
const testDatabaseUrl = postgresUrl.refine((url) => new URL(url).pathname.endsWith('_test'), {
  message: 'database name must end in _test',
});

export const testEnvSchema = z.object({
  TEST_DATABASE_URL: testDatabaseUrl,
  TEST_MIGRATION_DATABASE_URL: testDatabaseUrl,
});

// E2E runs leave their accounts and companies behind (nothing is deleted), so they get
// a database of their own, never the one used with `pnpm dev`.
const e2eDatabaseUrl = postgresUrl.refine((url) => new URL(url).pathname.endsWith('_e2e'), {
  message: 'database name must end in _e2e',
});

export const e2eEnvSchema = z.object({
  E2E_DATABASE_URL: e2eDatabaseUrl,
  E2E_MIGRATION_DATABASE_URL: e2eDatabaseUrl,
});

export type WebEnv = z.output<typeof webEnvSchema>;
export type WorkerEnv = z.output<typeof workerEnvSchema>;
export type MigrateEnv = z.output<typeof migrateEnvSchema>;
export type TestEnv = z.output<typeof testEnvSchema>;
export type E2eEnv = z.output<typeof e2eEnvSchema>;

type Source = Record<string, string | undefined>;

export class InvalidEnvError extends Error {
  override readonly name = 'InvalidEnvError';
}

// Empty is unset: parseFloat('') is NaN (Appendix B lesson 9).
function dropEmpty(source: Source): Source {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value?.trim()));
}

function parseEnv<T extends z.ZodType>(schema: T, source: Source): z.output<T> {
  const result = schema.safeParse(dropEmpty(source));
  if (result.success) return result.data;

  // Names and rules only, never values.
  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join('.');
    const rule = issue.code === 'invalid_type' ? 'is required' : issue.message;
    return `  ${name}: ${rule}`;
  });
  throw new InvalidEnvError(`Invalid environment:\n${problems.join('\n')}`);
}

export const loadWebEnv = (source: Source = process.env): WebEnv => parseEnv(webEnvSchema, source);

export const loadWorkerEnv = (source: Source = process.env): WorkerEnv =>
  parseEnv(workerEnvSchema, source);

export const loadMigrateEnv = (source: Source = process.env): MigrateEnv =>
  parseEnv(migrateEnvSchema, source);

export const loadTestEnv = (source: Source = process.env): TestEnv =>
  parseEnv(testEnvSchema, source);

export const loadE2eEnv = (source: Source = process.env): E2eEnv => parseEnv(e2eEnvSchema, source);
