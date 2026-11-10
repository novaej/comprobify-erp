import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  e2eEnvSchema,
  emailProviderOf,
  InvalidEnvError,
  loadE2eEnv,
  loadMigrateEnv,
  loadTestEnv,
  loadWebEnv,
  loadWorkerEnv,
  migrateEnvSchema,
  testEnvSchema,
  webEnvSchema,
  workerEnvSchema,
} from './env';

const worker = {
  APP_ENV: 'local',
  DATABASE_URL: 'postgres://app:secret-pw@localhost/db',
  APP_URL: 'http://localhost:3000',
  CERT_ENCRYPTION_KEY: 'a'.repeat(64),
};
const web = { ...worker, AUTH_SECRET: 'x'.repeat(32) };

const failure = (load: () => unknown): string => {
  try {
    load();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidEnvError);
    return (error as Error).message;
  }
  throw new Error('expected the env to be rejected');
};

describe('env loading', () => {
  it('applies defaults', () => {
    expect(loadWorkerEnv(worker)).toMatchObject({ LOG_LEVEL: 'info', SRI_MOCK_MODE: false });
  });

  it('treats empty and blank values as unset', () => {
    const env = loadWorkerEnv({ ...worker, LOG_LEVEL: '', SENTRY_DSN: '  ' });
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('reports every problem at once', () => {
    const message = failure(() => loadWebEnv({ APP_ENV: 'prod', APP_URL: 'nope' }));
    expect(message).toContain('APP_ENV');
    expect(message).toContain('DATABASE_URL: is required');
    expect(message).toContain('APP_URL');
  });

  it('never prints values', () => {
    const message = failure(() =>
      loadWorkerEnv({ ...worker, DATABASE_URL: 'mysql://app:secret-pw@localhost/db' }),
    );
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('secret-pw');
  });

  it('parses flags strictly', () => {
    expect(loadWorkerEnv({ ...worker, SRI_MOCK_MODE: 'true' }).SRI_MOCK_MODE).toBe(true);
    expect(failure(() => loadWorkerEnv({ ...worker, SRI_MOCK_MODE: '1' }))).toContain(
      'SRI_MOCK_MODE',
    );
  });

  it.each([
    ['web', () => loadWebEnv({ ...web, APP_ENV: 'production', SRI_MOCK_MODE: 'true' })],
    ['worker', () => loadWorkerEnv({ ...worker, APP_ENV: 'production', SRI_MOCK_MODE: 'true' })],
  ])('refuses SRI mock mode in production for %s', (_, load) => {
    expect(failure(load)).toContain('SRI_MOCK_MODE: must be false');
  });

  it('needs the operator RUC in production for the worker too, which issues for batches', () => {
    const production = { ...worker, APP_ENV: 'production', EMAIL_PROVIDER: 'none' };
    expect(failure(() => loadWorkerEnv(production))).toContain('OPERATOR_RUC: is required');
    expect(loadWorkerEnv({ ...production, OPERATOR_RUC: '1712345678001' }).OPERATOR_RUC).toBe(
      '1712345678001',
    );
  });

  it('allows SRI mock mode outside production', () => {
    const env = loadWebEnv({ ...web, APP_ENV: 'staging', SRI_MOCK_MODE: 'true' });
    expect(env.SRI_MOCK_MODE).toBe(true);
  });

  it('keeps the migration url separate from the app url', () => {
    expect(
      loadMigrateEnv({ APP_ENV: 'local', MIGRATION_DATABASE_URL: 'postgresql://o:p@h/d' }),
    ).toMatchObject({ MIGRATION_DATABASE_URL: 'postgresql://o:p@h/d' });
    expect(failure(() => loadMigrateEnv(worker))).toContain('MIGRATION_DATABASE_URL');
  });
});

describe('auth and email', () => {
  it('needs a long AUTH_SECRET for web', () => {
    expect(failure(() => loadWebEnv({ ...web, AUTH_SECRET: 'short' }))).toMatch(/AUTH_SECRET/);
  });

  it('lets local run without Mailgun', () => {
    expect(loadWorkerEnv(worker)).toMatchObject({ MAILGUN_REGION: 'us' });
  });

  it('requires Mailgun outside local, unless sending is off', () => {
    expect(failure(() => loadWorkerEnv({ ...worker, APP_ENV: 'staging' }))).toMatch(
      /MAILGUN_API_KEY: is required outside local/,
    );
    expect(
      emailProviderOf(loadWorkerEnv({ ...worker, APP_ENV: 'staging', EMAIL_PROVIDER: 'none' })),
    ).toBe('none');
    expect(
      failure(() =>
        loadWorkerEnv({ ...worker, EMAIL_PROVIDER: 'mailgun', MAILGUN_DOMAIN: 'mg.example.com' }),
      ),
    ).toMatch(/MAILGUN_API_KEY: is required to send through Mailgun/);
    // Links with tokens never reach a shared log.
    expect(
      failure(() => loadWorkerEnv({ ...worker, APP_ENV: 'staging', EMAIL_PROVIDER: 'log' })),
    ).toMatch(/EMAIL_PROVIDER: log is local only/);
  });

  it('chooses Mailgun when its keys are set, and the log otherwise, locally', () => {
    const keys = { MAILGUN_API_KEY: 'key', MAILGUN_DOMAIN: 'mg.example.com' };
    expect(emailProviderOf(loadWorkerEnv({ ...worker, ...keys }))).toBe('mailgun');
    expect(emailProviderOf(loadWorkerEnv(worker))).toBe('log');
  });

  it('refuses the test recipient in production', () => {
    const production = {
      ...worker,
      APP_ENV: 'production',
      MAILGUN_API_KEY: 'key',
      MAILGUN_DOMAIN: 'mg.example.com',
      EMAIL_REDIRECT_TO: 'owner@example.com',
    };
    expect(failure(() => loadWorkerEnv(production))).toMatch(
      /EMAIL_REDIRECT_TO: must be unset in production/,
    );
    expect(loadWorkerEnv({ ...production, APP_ENV: 'staging' })).toMatchObject({
      EMAIL_REDIRECT_TO: 'owner@example.com',
    });
  });
});

describe('legal agreements', () => {
  it('are off by default', () => {
    expect(loadWebEnv(web)).toMatchObject({ AGREEMENTS_ENABLED: false });
  });

  it('need the operator details once on', () => {
    const message = failure(() => loadWebEnv({ ...web, AGREEMENTS_ENABLED: 'true' }));
    for (const name of ['OPERATOR_NAME', 'OPERATOR_RUC', 'OPERATOR_ADDRESS', 'SUPPORT_EMAIL']) {
      expect(message).toContain(`${name}: is required when AGREEMENTS_ENABLED is true`);
    }
  });
});

describe('the operator RUC (Anexo 26)', () => {
  it('is required in production, so no invoice leaves out "RUC Proveedor"', () => {
    const message = failure(() => loadWebEnv({ ...web, APP_ENV: 'production' }));
    expect(message).toContain('OPERATOR_RUC: is required when APP_ENV is production');
    expect(() =>
      loadWebEnv({ ...web, APP_ENV: 'production', OPERATOR_RUC: '1712345678001' }),
    ).not.toThrow();
  });
});

describe('test env', () => {
  const app = 'postgres://app:x@localhost:5432/comprobify_erp_test';
  const owner = 'postgres://owner:x@localhost:5432/comprobify_erp_test';

  it('accepts databases named *_test', () => {
    expect(loadTestEnv({ TEST_DATABASE_URL: app, TEST_MIGRATION_DATABASE_URL: owner })).toEqual({
      TEST_DATABASE_URL: app,
      TEST_MIGRATION_DATABASE_URL: owner,
    });
  });

  it('refuses any other database', () => {
    const load = () =>
      loadTestEnv({
        TEST_DATABASE_URL: app.replace('_test', '_local'),
        TEST_MIGRATION_DATABASE_URL: owner,
      });
    expect(load).toThrow(/TEST_DATABASE_URL: database name must end in _test/);
  });
});

describe('loadE2eEnv', () => {
  it('refuses a database that is not an E2E one', () => {
    const app = 'postgres://app:secret@localhost:5432/comprobify_erp_local';
    expect(() => loadE2eEnv({ E2E_DATABASE_URL: app, E2E_MIGRATION_DATABASE_URL: app })).toThrow(
      /E2E_DATABASE_URL: database name must end in _e2e/,
    );
    const e2e = 'postgres://app:secret@localhost:5432/comprobify_erp_e2e';
    expect(loadE2eEnv({ E2E_DATABASE_URL: e2e, E2E_MIGRATION_DATABASE_URL: e2e })).toEqual({
      E2E_DATABASE_URL: e2e,
      E2E_MIGRATION_DATABASE_URL: e2e,
    });
  });
});

describe('.env.example', () => {
  const example = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
  const documented = new Set(
    [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]),
  );

  it('documents every schema variable', () => {
    const keys = [
      webEnvSchema,
      workerEnvSchema,
      migrateEnvSchema,
      testEnvSchema,
      e2eEnvSchema,
    ].flatMap((schema) => Object.keys(schema.shape));
    expect(keys.filter((key) => !documented.has(key))).toEqual([]);
  });
});

// ADR-014: only the owner sends to SRI, from the gate checklist. Everything automated
// answers from the mock.
describe('the SRI mock and email in automated runs', () => {
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

  it('is on in CI, in the local stack and in the example env', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/^ {2}SRI_MOCK_MODE: 'true'$/m);
    const stack = read('infra/compose.yaml');
    expect(stack.match(/SRI_MOCK_MODE: 'true'/g)).toHaveLength(2);
    // Nor does the stack's worker email anyone (ADR-015).
    expect(stack).toMatch(/^ {6}EMAIL_PROVIDER: log$/m);
    expect(read('.env.example')).toMatch(/^SRI_MOCK_MODE=true$/m);
    expect(read('.github/workflows/ci.yml')).not.toMatch(/SRI_(TEST|PRODUCTION)_URL/);
  });
});
