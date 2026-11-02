import type { Logger } from '@comprobify/config/logger';
import { describe, expect, it, vi } from 'vitest';
import { UnsafeDatabaseError, assertSafeConnection, type Queryable } from './boot-guard';
import { createDatabase } from './context';

function fakeLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  };
  return logger;
}

function fakeRole(attributes: { rolsuper: boolean; rolbypassrls: boolean }): Queryable {
  const query = (text: string) =>
    Promise.resolve({ rows: text.includes('pg_roles') ? [attributes] : [] });
  return { query } as unknown as Queryable;
}

describe('boot guard (NFR-SEC-4)', () => {
  it('refuses a superuser', async () => {
    const db = fakeRole({ rolsuper: true, rolbypassrls: false });
    await expect(assertSafeConnection(db)).rejects.toThrow(/superuser/);
  });

  it('refuses BYPASSRLS', async () => {
    const db = fakeRole({ rolsuper: false, rolbypassrls: true });
    await expect(assertSafeConnection(db)).rejects.toBeInstanceOf(UnsafeDatabaseError);
  });

  it('accepts a plain role', async () => {
    const db = fakeRole({ rolsuper: false, rolbypassrls: false });
    await expect(assertSafeConnection(db)).resolves.toBeUndefined();
  });
});

describe('context arguments (NFR-SEC-2)', () => {
  // Rejected before any connection, so no database is needed.
  const db = createDatabase({
    connectionString: 'postgres://nobody@127.0.0.1:1/none',
    logger: fakeLogger(),
  });

  it.each(['', '   '])('refuses an empty system reason: %j', async (reason) => {
    await expect(db.withSystem(reason, () => Promise.resolve())).rejects.toThrow(/reason/);
  });

  it.each(['', '42', 'not-a-uuid'])('refuses a malformed tenant id: %j', async (tenantId) => {
    await expect(db.withTenant({ tenantId }, () => Promise.resolve())).rejects.toThrow(/tenant id/);
  });
});
