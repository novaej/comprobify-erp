import { randomUUID } from 'node:crypto';
import {
  ACTIVITY_PAGE_SIZE,
  activityCounts,
  createModule,
  createPlan,
  fixedClock,
  platformActivity,
  type PlatformActor,
} from '@comprobify/core';
import { eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

// FR-ADM-1: the platform's own log, read by the operator: newest first, by group, a page at a
// time, naming who did it.
describe('the platform activity log', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let admin: PlatformActor;
  let adminEmail: string;
  const unique = () => randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();

  beforeAll(async () => {
    db = appDatabase();
    admin = { ...(await superAdmin(db)), clock };
    const [user] = await db.identity
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, admin.userId));
    adminEmail = user!.email;
  });

  afterAll(() => db.close());

  it('shows who changed what, newest first, and filters by group', async () => {
    const plan = `P_${unique()}`;
    const module = `M_${unique()}`;
    await createModule(admin, db, { key: module, nameEs: 'Uno', nameEn: 'One' });
    await createPlan(admin, db, { key: plan, nameEs: 'Plan', nameEn: 'Plan', selfService: true });

    const all = await platformActivity(admin, db);
    expect(all.rows[0]).toMatchObject({ action: 'plan.created', actorEmail: adminEmail });
    expect(all.rows[0]!.details).toMatchObject({ plan });
    expect(all.rows[1]).toMatchObject({ action: 'module.created' });
    expect(all.rows[1]!.details).toMatchObject({ module });
    // Newest first.
    const times = all.rows.map((row) => row.occurredAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const modules = await platformActivity(admin, db, { group: 'module' });
    expect(modules.rows.length).toBeGreaterThan(0);
    expect(modules.rows.every((row) => row.action.startsWith('module.'))).toBe(true);
    const counts = await activityCounts(admin, db);
    expect(counts.module).toBeGreaterThanOrEqual(1);
    expect(counts.plan).toBeGreaterThanOrEqual(1);
  });

  it('pages through more than a page of entries', async () => {
    for (let i = 0; i < ACTIVITY_PAGE_SIZE + 2; i++)
      await createModule(admin, db, { key: `M_${unique()}`, nameEs: 'Uno', nameEn: 'One' });
    const first = await platformActivity(admin, db, { page: 1 });
    expect(first.rows).toHaveLength(ACTIVITY_PAGE_SIZE);
    expect(first.hasMore).toBe(true);
    const second = await platformActivity(admin, db, { page: 2 });
    expect(second.rows.length).toBeGreaterThan(0);
    expect(second.rows.map((row) => row.id)).not.toContain(first.rows[0]!.id);
  });

  it('is the super admin’s alone', async () => {
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Nadie', email: `pa.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    const notAdmin = { userId: user!.id, isSuperAdmin: true as const, clock };
    await expect(platformActivity(notAdmin, db)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(activityCounts(notAdmin, db)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
