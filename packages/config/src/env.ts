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

// Email (ADR-015). mailgun sends, log writes to the log (local only: links carry tokens),
// none sends nothing. Unset: mailgun with keys, log locally without them.
const mailShape = {
  EMAIL_PROVIDER: z.enum(['mailgun', 'log', 'none']).optional(),
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  MAILGUN_REGION: z.enum(['us', 'eu']).default('us'),
  EMAIL_FROM: z.string().default('Comprobify <no-reply@comprobify.com>'),
  // The buyer's copy of a document; EMAIL_FROM when unset.
  EMAIL_FROM_DOCUMENTS: z.string().optional(),
  // Every email to this one address instead, for a copy of real data. Refused in production.
  EMAIL_REDIRECT_TO: z.email().optional(),
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

type MailEnv = {
  APP_ENV: string;
  EMAIL_PROVIDER?: 'mailgun' | 'log' | 'none' | undefined;
  MAILGUN_API_KEY?: string | undefined;
  MAILGUN_DOMAIN?: string | undefined;
  EMAIL_REDIRECT_TO?: string | undefined;
};

// The provider the worker uses, once the env is valid.
export function emailProviderOf(env: MailEnv): 'mailgun' | 'log' | 'none' {
  if (env.EMAIL_PROVIDER) return env.EMAIL_PROVIDER;
  return env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN ? 'mailgun' : 'log';
}

function checkMail(env: MailEnv, ctx: z.RefinementCtx): void {
  const provider = emailProviderOf(env);
  if (provider === 'mailgun')
    for (const name of ['MAILGUN_API_KEY', 'MAILGUN_DOMAIN'] as const) {
      if (!env[name])
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: 'is required to send through Mailgun',
        });
    }
  if (provider === 'log' && env.APP_ENV !== 'local')
    ctx.addIssue({
      code: 'custom',
      path: env.EMAIL_PROVIDER ? ['EMAIL_PROVIDER'] : ['MAILGUN_API_KEY'],
      message: env.EMAIL_PROVIDER
        ? 'log is local only: it writes links with tokens to the log'
        : 'is required outside local (or set EMAIL_PROVIDER=none)',
    });
  if (env.EMAIL_REDIRECT_TO && env.APP_ENV === 'production')
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_REDIRECT_TO'],
      message: "must be unset in production: it would divert real buyers' invoices",
    });
}

// AES-256-GCM key for each company's stored certificate private key (FR-ONB-3); it never
// signs. The worker decrypts a company's key with it for that company's re-issues (FR-DOC-6).
const certificateKey = z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters');

// SRI's services (ADR-014): the worker sends and asks, the web asks when voiding. The URLs default, in core, to SRI's own.
const sriShape = {
  SRI_TEST_URL: z.url().optional(),
  SRI_PRODUCTION_URL: z.url().optional(),
  SRI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
};

// What issuing a document needs from the deployment: the operator's RUC, printed as "RUC
// Proveedor" (Anexo 26), and the most a consumidor final invoice may total (FR-DOC-9, in
// dollars). The worker issues too, for batches (ADR-026).
const operatorRuc = z
  .string()
  .regex(/^[0-9]{13}$/, 'must be 13 digits')
  .optional();
const consumerFinalMaxAmount = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, 'must be an amount such as 50.00')
  .default('50.00');

// FR-BILL-2: the IVA rate charged on subscriptions, a percent such as 15. Each payment keeps
// the rate it was created with.
const ivaRate = z
  .string()
  .regex(/^\d{1,2}(\.\d{1,2})?$/, 'must be a percent such as 15')
  .default('15');

function requireOperatorRuc(
  env: { APP_ENV: string; OPERATOR_RUC?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (env.APP_ENV === 'production' && !env.OPERATOR_RUC) {
    ctx.addIssue({
      code: 'custom',
      path: ['OPERATOR_RUC'],
      message: 'is required when APP_ENV is production (printed as "RUC Proveedor")',
    });
  }
}

export const webEnvSchema = z
  .object({
    ...runtimeShape,
    ...sriShape,
    APP_URL: z.url(),
    // Signs session cookies and tokens. Rotating it signs everyone out.
    AUTH_SECRET: z.string().min(32),
    CERT_ENCRYPTION_KEY: certificateKey,
    // Off until the owner approves the legal texts (docs/legal/review-notes.md).
    AGREEMENTS_ENABLED: flag.default(false),
    // The operator named in the legal texts; required once agreements are on.
    OPERATOR_NAME: z.string().optional(),
    OPERATOR_RUC: operatorRuc,
    OPERATOR_ADDRESS: z.string().optional(),
    SUPPORT_EMAIL: z.email().optional(),
    CONSUMER_FINAL_MAX_AMOUNT: consumerFinalMaxAmount,
    IVA_RATE: ivaRate,
  })
  .superRefine((env, ctx) => {
    refuseMockInProduction(env, ctx);
    requireOperatorRuc(env, ctx);
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

export const workerEnvSchema = z
  .object({
    ...runtimeShape,
    ...mailShape,
    ...sriShape,
    // Billing emails link back to the app (ADR-032).
    APP_URL: z.url(),
    CERT_ENCRYPTION_KEY: certificateKey,
    OPERATOR_RUC: operatorRuc,
    CONSUMER_FINAL_MAX_AMOUNT: consumerFinalMaxAmount,
    IVA_RATE: ivaRate,
  })
  .superRefine((env, ctx) => {
    refuseMockInProduction(env, ctx);
    requireOperatorRuc(env, ctx);
    checkMail(env, ctx);
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
