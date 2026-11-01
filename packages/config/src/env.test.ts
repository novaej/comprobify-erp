import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  InvalidEnvError,
  loadMigrateEnv,
  loadWebEnv,
  loadWorkerEnv,
  migrateEnvSchema,
  webEnvSchema,
  workerEnvSchema,
} from './env';

const worker = { APP_ENV: 'local', DATABASE_URL: 'postgres://app:secret-pw@localhost/db' };
const web = { ...worker, APP_URL: 'http://localhost:3000' };

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

describe('.env.example', () => {
  const example = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
  const documented = new Set(
    [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]),
  );

  it('documents every schema variable', () => {
    const keys = [webEnvSchema, workerEnvSchema, migrateEnvSchema].flatMap((schema) =>
      Object.keys(schema.shape),
    );
    expect(keys.filter((key) => !documented.has(key))).toEqual([]);
  });
});
