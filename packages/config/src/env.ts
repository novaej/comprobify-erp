import { z } from 'zod';

const appEnv = z.enum(['local', 'staging', 'production']);
const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

const sharedShape = {
  APP_ENV: appEnv,
  LOG_LEVEL: logLevel.default('info'),
  BETTERSTACK_SOURCE_TOKEN: z.string().optional(),
  SENTRY_DSN: z.url().optional(),
};

const runtimeShape = {
  ...sharedShape,
  DATABASE_URL: postgresUrl,
  SRI_MOCK_MODE: flag.default(false),
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

export const webEnvSchema = z
  .object({ ...runtimeShape, APP_URL: z.url() })
  .superRefine(refuseMockInProduction);

export const workerEnvSchema = z.object(runtimeShape).superRefine(refuseMockInProduction);

export const migrateEnvSchema = z.object({
  ...sharedShape,
  MIGRATION_DATABASE_URL: postgresUrl,
});

export type WebEnv = z.output<typeof webEnvSchema>;
export type WorkerEnv = z.output<typeof workerEnvSchema>;
export type MigrateEnv = z.output<typeof migrateEnvSchema>;

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
