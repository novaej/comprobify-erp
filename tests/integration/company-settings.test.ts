import { randomUUID } from 'node:crypto';
import {
  companySettings,
  createBranch,
  createIssuePoint,
  createOrganization,
  fixedClock,
  goLive,
  resolveActor,
  setIssuePointDocumentType,
  setIssuePointPaused,
  setOverride,
  updateCompanyProfile,
  type ActorContext,
  type CreatedOrganization,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

// FR-ONB-3, FR-ONB-5, FR-PLAN-3, FR-MD-4, SRI rule 9.
describe('company settings', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let ownerId: string;

  const company = () =>
    createOrganization(db, {
      ownerUserId: ownerId,
      ruc: testRuc(),
      legalName: 'Omicron S.A.',
      tradeName: null,
      mainAddress: 'Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
  const actor = (tenantId: string) => resolveActor(db, { userId: ownerId, tenantId, clock });
  const sequences = (tenantId: string) =>
    db.withTenant({ tenantId }, ({ db: tx }) =>
      tx
        .select({
          documentType: schema.documentSequences.documentType,
          next: schema.documentSequences.nextValue,
        })
        .from(schema.documentSequences),
    );
  const exception = async (
    org: CreatedOrganization,
    featureKey: string,
    value: number | null,
    effect: 'LIMIT' | 'REVOKE' = 'LIMIT',
  ) =>
    setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey,
      effect,
      limitValue: effect === 'LIMIT' ? value : null,
      reason: 'test',
    });

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `cs.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
  });

  afterAll(() => db.close());

  it('starts every company and its twin issuing facturas, each with its own counter', async () => {
    const org = await company();
    for (const tenantId of [org.realTenantId, org.twinTenantId]) {
      const settings = await companySettings(await actor(tenantId), db);
      expect(settings.branches).toMatchObject([
        { code: '001', issuePoints: [{ code: '001', canIssue: true, documentTypes: ['01'] }] },
      ]);
      await expect(sequences(tenantId)).resolves.toEqual([{ documentType: '01', next: 1 }]);
    }
  });

  it('sets the tax data in the company and its twin, within the XSD patterns', async () => {
    const org = await company();
    const owner = await actor(org.twinTenantId);
    const profile = {
      tradeName: 'Omicron',
      mainAddress: 'Av. Amazonas, Quito',
      requiredAccounting: true,
      specialTaxpayerResolution: '12345',
      withholdingAgentResolution: '1',
      taxRegime: 'RIMPE_EMPRENDEDOR' as const,
    };
    await updateCompanyProfile(owner, db, profile);
    for (const tenantId of [org.realTenantId, org.twinTenantId])
      expect((await companySettings(await actor(tenantId), db)).profile).toMatchObject(profile);
    await expect(
      updateCompanyProfile(owner, db, { ...profile, withholdingAgentResolution: '123456789' }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    const viewer = { ...owner, permissions: [] } satisfies ActorContext;
    await expect(updateCompanyProfile(viewer, db, profile)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('adds branches and issue points within the plan, mirrored by code', async () => {
    const org = await company();
    // Gratis allows one branch, with one issue point.
    await expect(
      createBranch(await actor(org.realTenantId), db, {
        code: '002',
        name: 'Norte',
        address: 'Quito',
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
    await exception(org, 'MAX_BRANCHES', 3);
    await createBranch(await actor(org.realTenantId), db, {
      code: '002',
      name: 'Norte',
      address: 'Av. 6 de Diciembre',
    });
    await expect(
      createBranch(await actor(org.realTenantId), db, {
        code: '002',
        name: 'Otra',
        address: 'Quito',
      }),
    ).rejects.toMatchObject({ code: 'CODE_TAKEN' });

    const twin = await companySettings(await actor(org.twinTenantId), db);
    const north = twin.branches.find((branch) => branch.code === '002')!;
    expect(north).toMatchObject({ name: 'Norte', issuePoints: [] });
    // Added from the twin, it lands in the real company too.
    await createIssuePoint(await actor(org.twinTenantId), db, { branchId: north.id, code: '001' });
    await expect(
      createIssuePoint(await actor(org.twinTenantId), db, { branchId: north.id, code: '002' }),
    ).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
    const real = await companySettings(await actor(org.realTenantId), db);
    expect(real.branches.find((branch) => branch.code === '002')!.issuePoints).toMatchObject([
      { code: '001', documentTypes: ['01'] },
    ]);
    const warehouses = await db.withTenant({ tenantId: org.realTenantId }, ({ db: tx }) =>
      tx.select().from(schema.warehouses),
    );
    expect(warehouses).toHaveLength(2);
  });

  it('enables a type only with its feature, and keeps one already enabled (FR-PLAN-3)', async () => {
    const org = await company();
    const owner = await actor(org.realTenantId);
    const [point] = (await companySettings(owner, db)).branches[0]!.issuePoints;
    // 07 has no builder yet; 04 has one, but this plan lacks its feature.
    await expect(
      setIssuePointDocumentType(owner, db, {
        issuePointId: point!.id,
        documentType: '07',
        enabled: true,
      }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    await expect(
      setIssuePointDocumentType(owner, db, {
        issuePointId: point!.id,
        documentType: '04',
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: 'FEATURE_NOT_ENABLED' });

    await exception(org, 'DOC_TYPE_01', null, 'REVOKE');
    const withoutFacturas = await actor(org.realTenantId);
    // Still enabled: losing the feature doesn't switch it off.
    expect(
      (await companySettings(withoutFacturas, db)).branches[0]!.issuePoints[0]!.documentTypes,
    ).toEqual(['01']);
    await setIssuePointDocumentType(withoutFacturas, db, {
      issuePointId: point!.id,
      documentType: '01',
      enabled: false,
    });
    await expect(
      setIssuePointDocumentType(withoutFacturas, db, {
        issuePointId: point!.id,
        documentType: '01',
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: 'FEATURE_NOT_ENABLED' });
  });

  it('pauses an issue point in the company and its twin', async () => {
    const org = await company();
    const owner = await actor(org.realTenantId);
    const [point] = (await companySettings(owner, db)).branches[0]!.issuePoints;
    await setIssuePointPaused(owner, db, { issuePointId: point!.id, canIssue: false });
    for (const tenantId of [org.realTenantId, org.twinTenantId])
      expect(
        (await companySettings(await actor(tenantId), db)).branches[0]!.issuePoints[0]!.canIssue,
      ).toBe(false);
  });

  it('sets the real company’s starting numbers at go-live, never the twin’s', async () => {
    const org = await company();
    const owner = await actor(org.twinTenantId);
    await goLive(owner, db, {
      requireAgreements: false,
      startingSequentials: [
        { branchCode: '001', pointCode: '001', documentType: '01', next: 1251 },
      ],
    });
    await expect(sequences(org.realTenantId)).resolves.toEqual([
      { documentType: '01', next: 1251 },
    ]);
    await expect(sequences(org.twinTenantId)).resolves.toEqual([{ documentType: '01', next: 1 }]);

    // A number below the current one would repeat a sequential: refused, and nothing changes.
    const other = await company();
    await db.withSystem('test: a sequence already advanced', ({ executeSql }) =>
      executeSql(`UPDATE document_sequences SET next_value = 2000 WHERE tenant_id = $1`, [
        other.realTenantId,
      ]),
    );
    await expect(
      goLive(await actor(other.realTenantId), db, {
        requireAgreements: false,
        startingSequentials: [
          { branchCode: '001', pointCode: '001', documentType: '01', next: 1500 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'SEQUENCE_BACKWARD' });
    const [tenant] = await db.withTenant({ tenantId: other.realTenantId }, ({ db: tx }) =>
      tx.select({ liveAt: schema.tenants.liveAt }).from(schema.tenants),
    );
    expect(tenant!.liveAt).toBeNull();
  });
});
