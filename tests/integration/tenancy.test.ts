import { randomBytes, randomUUID } from 'node:crypto';
import {
  createOrganization,
  fixedClock,
  listOrganizations,
  resolveActor,
  switchOrganization,
  type CreatedOrganization,
} from '@comprobify/core';
import { eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase } from './helpers';

const noContext = { code: '42501', message: 'RLS: no tenant, user or system context' };

// FR-ONB-4, FR-ONB-6a, FR-USR-5, NFR-SEC-1, ADR-010. Milestone 1 gate: isolation.
describe('tenancy', () => {
  const clock = fixedClock(new Date().toISOString());
  let db: Database;
  let owner: string;
  let stranger: string;
  let a: CreatedOrganization;
  let b: CreatedOrganization;

  const newUser = async (): Promise<string> => {
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Test', email: `t.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    return user!.id;
  };
  const ruc = () => `17${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;
  const organization = (ownerUserId: string, name: string) =>
    createOrganization(db, {
      ownerUserId,
      ruc: ruc(),
      legalName: name,
      tradeName: null,
      mainAddress: 'Av. Amazonas N24, Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
  const branchesIn = (tenantId: string) =>
    db.withTenant({ tenantId }, ({ db: tx }) => tx.select().from(schema.branches));

  beforeAll(async () => {
    db = appDatabase();
    owner = await newUser();
    stranger = await newUser();
    a = await organization(owner, 'Alfa S.A.');
    b = await organization(stranger, 'Beta Cía. Ltda.');
  });

  afterAll(() => db.close());

  describe('createOrganization', () => {
    it('creates the real organization and its twin, each with a branch, issue point and warehouse', async () => {
      for (const [tenantId, mode] of [
        [a.realTenantId, 'PRODUCTION'],
        [a.twinTenantId, 'TEST'],
      ] as const) {
        const rows = await db.withTenant({ tenantId }, async ({ db: tx }) => ({
          tenants: await tx.select().from(schema.tenants),
          branches: await tx.select().from(schema.branches),
          issuePoints: await tx.select().from(schema.issuePoints),
          warehouses: await tx.select().from(schema.warehouses),
          memberships: await tx.select().from(schema.memberships),
        }));
        expect(rows.tenants).toHaveLength(1);
        expect(rows.tenants[0]).toMatchObject({ mode, liveAt: null });
        expect(rows.branches).toMatchObject([{ code: '001', address: 'Av. Amazonas N24, Quito' }]);
        expect(rows.issuePoints).toMatchObject([{ code: '001', canIssue: true }]);
        expect(rows.warehouses).toHaveLength(1);
        expect(rows.memberships).toMatchObject([{ userId: owner, role: 'OWNER', active: true }]);
      }
      const [twin] = await db.withTenant({ tenantId: a.twinTenantId }, ({ db: tx }) =>
        tx.select().from(schema.tenants),
      );
      expect(twin?.twinOf).toBe(a.realTenantId);
    });

    it('refuses a second organization with the same RUC', async () => {
      const [real] = await db.withTenant({ tenantId: a.realTenantId }, ({ db: tx }) =>
        tx.select().from(schema.tenants),
      );
      await expect(
        createOrganization(db, {
          ownerUserId: stranger,
          ruc: real!.ruc,
          legalName: 'Copia',
          tradeName: null,
          mainAddress: 'x',
          branch: { code: '001', name: 'Matriz', address: null },
          issuePointCode: '001',
        }),
      ).rejects.toMatchObject({ code: 'RUC_TAKEN' });
    });
  });

  describe('isolation', () => {
    it('keeps two organizations apart', async () => {
      const seen = await branchesIn(a.realTenantId);
      expect(seen.every((branch) => branch.tenantId === a.realTenantId)).toBe(true);
      const tenants = await db.withTenant({ tenantId: a.realTenantId }, ({ db: tx }) =>
        tx.select({ id: schema.tenants.id }).from(schema.tenants),
      );
      expect(tenants).toEqual([{ id: a.realTenantId }]);
    });

    it('keeps an organization and its twin apart like any two tenants', async () => {
      const real = await branchesIn(a.realTenantId);
      const twin = await branchesIn(a.twinTenantId);
      expect(real.map((branch) => branch.id)).not.toContain(twin[0]!.id);
      expect(twin.every((branch) => branch.tenantId === a.twinTenantId)).toBe(true);
    });

    it("refuses a write into another tenant's rows", async () => {
      await expect(
        db.withTenant({ tenantId: a.realTenantId }, ({ db: tx }) =>
          tx.insert(schema.branches).values({
            tenantId: b.realTenantId,
            code: '002',
            name: 'Intrusa',
            address: 'x',
          }),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
    });

    it("refuses an issue point that points at another tenant's branch", async () => {
      const [foreignBranch] = await branchesIn(b.realTenantId);
      await expect(
        db.withSystem('test: cross-tenant reference', ({ db: tx }) =>
          tx.insert(schema.issuePoints).values({
            tenantId: a.realTenantId,
            branchId: foreignBranch!.id,
            code: '009',
          }),
        ),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });

    it('raises with no context on tenants and memberships', async () => {
      for (const table of ['tenants', 'memberships']) {
        // Clearing the user setting leaves a transaction with no context at all.
        await expect(
          db.withUser(randomUUID(), async ({ executeSql }) => {
            await executeSql(`SELECT set_config('app.user_id', '', true)`);
            return executeSql(`SELECT 1 FROM ${table}`);
          }),
        ).rejects.toMatchObject(noContext);
      }
    });
  });

  describe('user context', () => {
    it("lists the user's organizations, each with its twin, and nothing else", async () => {
      const entries = await listOrganizations(db, owner);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        realTenantId: a.realTenantId,
        twinTenantId: a.twinTenantId,
        name: 'Alfa S.A.',
        role: 'OWNER',
        live: false,
      });
      expect(entries[0]?.ruc).toMatch(/^[0-9]{13}$/);
      await expect(listOrganizations(db, await newUser())).resolves.toEqual([]);
    });

    it('cannot read tenant data or write', async () => {
      await expect(
        db.withUser(owner, ({ db: tx }) => tx.select().from(schema.branches)),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
      await expect(
        db.withUser(owner, ({ db: tx }) =>
          tx.insert(schema.memberships).values({
            tenantId: b.realTenantId,
            userId: owner,
            role: 'OWNER',
          }),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
      const updated = await db
        .withUser(owner, ({ db: tx }) =>
          tx
            .update(schema.tenants)
            .set({ legalName: 'Hijacked' })
            .where(eq(schema.tenants.id, a.realTenantId))
            .returning(),
        )
        .catch((error: unknown) => error);
      expect(updated).toMatchObject({ cause: { code: '42501' } });
    });
  });

  describe('actor context', () => {
    it('builds the actor from the membership, with the tenant mode', async () => {
      const real = await resolveActor(db, { userId: owner, tenantId: a.realTenantId, clock });
      const twin = await resolveActor(db, { userId: owner, tenantId: a.twinTenantId, clock });
      expect(real).toMatchObject({ tenantMode: 'PRODUCTION', userId: owner, issuePointIds: null });
      expect(twin.tenantMode).toBe('TEST');
      expect(real.permissions).toContain('organization.go_live');
    });

    it('refuses a user who is not a member', async () => {
      await expect(
        resolveActor(db, { userId: stranger, tenantId: a.realTenantId, clock }),
      ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    });

    it('switches the active organization only to one the user belongs to', async () => {
      const [session] = await db.identity
        .insert(schema.sessions)
        .values({
          token: randomBytes(24).toString('hex'),
          userId: owner,
          expiresAt: new Date(Date.now() + 60_000),
        })
        .returning({ id: schema.sessions.id });
      await switchOrganization(db, {
        userId: owner,
        sessionId: session!.id,
        tenantId: a.twinTenantId,
      });
      const [after] = await db.identity
        .select({ active: schema.sessions.activeTenantId })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, session!.id));
      expect(after?.active).toBe(a.twinTenantId);

      await expect(
        switchOrganization(db, { userId: owner, sessionId: session!.id, tenantId: b.realTenantId }),
      ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    });
  });

  it('refuses a role outside the list (CLAUDE.md rule 17)', async () => {
    await expect(
      db.withTenant({ tenantId: a.realTenantId }, async ({ executeSql }) =>
        executeSql(
          `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'DEVELOPER')`,
          [a.realTenantId, stranger],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
