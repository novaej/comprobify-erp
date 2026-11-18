import { randomUUID } from 'node:crypto';
import {
  createOrganization,
  fixedClock,
  resolveActor,
  sessionIdleMinutes,
  setIdleTimeout,
  type ActorContext,
  type CreatedOrganization,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase } from './helpers';

// FR-USR-2, ADR-045: the idle timeout is the company's, the same in its test copy.
describe('the idle timeout of a company', () => {
  const clock = fixedClock('2026-11-18T15:00:00Z');
  let db: Database;
  let org: CreatedOrganization;
  let owner: ActorContext;

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `it.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    org = await createOrganization(db, {
      ownerUserId: user!.id,
      ruc: testRuc(),
      legalName: 'Idle S.A.',
      tradeName: null,
      mainAddress: 'Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
    owner = await resolveActor(db, { userId: user!.id, tenantId: org.twinTenantId, clock });
  });
  afterAll(() => db.close());

  it('is 30 minutes until changed, and outside any company', async () => {
    await expect(sessionIdleMinutes(db, org.realTenantId)).resolves.toBe(30);
    await expect(sessionIdleMinutes(db, null)).resolves.toBe(30);
    await expect(sessionIdleMinutes(db, 'not-a-uuid')).resolves.toBe(30);
  });

  it('is set on the company and its test copy together, within 5 minutes and 8 hours', async () => {
    await setIdleTimeout(owner, db, 120);
    await expect(sessionIdleMinutes(db, org.realTenantId)).resolves.toBe(120);
    await expect(sessionIdleMinutes(db, org.twinTenantId)).resolves.toBe(120);
    await expect(setIdleTimeout(owner, db, 4)).rejects.toThrow();
    await expect(setIdleTimeout(owner, db, 481)).rejects.toThrow();
    const viewer = { ...owner, permissions: ['documents.read'] } as unknown as ActorContext;
    await expect(setIdleTimeout(viewer, db, 60)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
