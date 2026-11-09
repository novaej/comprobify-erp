import { createHash, randomUUID } from 'node:crypto';
import {
  acceptAgreements,
  agreementStatus,
  companyAgreement,
  createOrganization,
  fixedClock,
  goLive,
  listAuditEvents,
  personalize,
  publishAgreements,
  resolveActor,
  type ActorContext,
  type CreatedOrganization,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, asOwner, ownerDatabase } from './helpers';

const parties = {
  operator: {
    name: 'Operadora Prueba',
    ruc: '1712345678001',
    address: 'Quito',
    supportEmail: 'soporte@example.com',
  },
};

// FR-ONB-8, FR-ONB-5.
describe('legal agreements', () => {
  const clock = fixedClock(new Date().toISOString());
  let db: Database;
  let org: CreatedOrganization;
  let ruc: string;
  let ownerCtx: ActorContext;

  beforeAll(async () => {
    db = appDatabase();
    const [owner] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `ag.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ruc = testRuc();
    org = await createOrganization(db, {
      ownerUserId: owner!.id,
      ruc,
      legalName: 'Theta Cía. Ltda.',
      tradeName: null,
      mainAddress: 'Ambato',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
    ownerCtx = await resolveActor(db, { userId: owner!.id, tenantId: org.twinTenantId, clock });
  });

  afterAll(() => db.close());

  it('publishes the three texts, which the app role can only read', async () => {
    const status = await agreementStatus(ownerCtx, db);
    expect(status.map((row) => row.type).sort()).toEqual(['DPA', 'PRIVACY', 'TERMS']);
    expect(status.every((row) => !row.accepted)).toBe(true);
    await expect(
      db.withSystem('test: write a template', ({ executeSql }) =>
        executeSql(`UPDATE agreement_templates SET content_markdown = 'x'`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('personalizes every placeholder, and refuses an unknown one', () => {
    expect(
      personalize('{{cliente.ruc}} / {{operador.nombre}}', parties, { legalName: 'A', ruc: '1' }),
    ).toBe('1 / Operadora Prueba');
    expect(() => personalize('{{otro.campo}}', parties, { legalName: 'A', ruc: '1' })).toThrow(
      /Unknown placeholder/,
    );
  });

  it('lets only the owner accept', async () => {
    const admin = {
      ...ownerCtx,
      permissions: ownerCtx.permissions.filter((p) => p !== 'organization.accept_agreements'),
    };
    await expect(
      acceptAgreements(admin, db, { ipAddress: null, userAgent: null }, parties),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('keeps go-live closed until the company accepts, when agreements are on', async () => {
    await expect(goLive(ownerCtx, db, { requireAgreements: true })).rejects.toMatchObject({
      code: 'AGREEMENTS_PENDING',
    });
  });

  it('records the exact personalized copy, who accepted it and from where, once', async () => {
    await acceptAgreements(
      ownerCtx,
      db,
      { ipAddress: '203.0.113.5', userAgent: 'Test Browser' },
      parties,
    );
    await acceptAgreements(
      ownerCtx,
      db,
      { ipAddress: '203.0.113.5', userAgent: 'Test Browser' },
      parties,
    );

    const rows = await db.withTenant({ tenantId: org.realTenantId }, ({ db: tx }) =>
      tx.select().from(schema.agreementAcceptances),
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({ ipAddress: '203.0.113.5', userAgent: 'Test Browser' });
      expect(row.contentMarkdown).not.toContain('{{');
      expect(row.contentHash).toBe(createHash('sha256').update(row.contentMarkdown).digest('hex'));
    }
    expect(rows.find((row) => row.documentType === 'DPA')!.contentMarkdown).toContain(ruc);

    // The current version of each text, whatever earlier test runs published.
    const status = await agreementStatus(ownerCtx, db);
    expect(status.every((row) => row.accepted)).toBe(true);
    for (const row of rows) {
      expect(row.version).toBe(status.find((entry) => entry.type === row.documentType)!.version);
    }
    const copy = await companyAgreement(ownerCtx, db, 'DPA', parties);
    expect(copy?.markdown).toContain('Theta Cía. Ltda.');

    const events = (await listAuditEvents({ ...ownerCtx, tenantId: org.realTenantId }, db)).filter(
      (event) => event.action === 'agreements.accepted',
    );
    expect(events).toHaveLength(1);
  });

  it('cannot change an acceptance', async () => {
    await expect(
      db.withTenant({ tenantId: org.realTenantId }, ({ executeSql }) =>
        executeSql(`UPDATE agreement_acceptances SET ip_address = 'forged'`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('opens go-live once accepted', async () => {
    await expect(goLive(ownerCtx, db, { requireAgreements: true })).resolves.toEqual({
      realTenantId: org.realTenantId,
      copied: null,
    });
  });

  it('asks again when a new version is published', async () => {
    await asOwner(async (owner) => {
      await owner.query(
        `INSERT INTO agreement_templates (document_type, version, content_markdown, content_hash)
         SELECT 'TERMS', max(version) + 1, 'Nuevos términos para {{cliente.razonSocial}}', 'test-' || gen_random_uuid()
         FROM agreement_templates WHERE document_type = 'TERMS'`,
      );
    });
    const terms = (await agreementStatus(ownerCtx, db)).find((row) => row.type === 'TERMS');
    expect(terms).toMatchObject({ accepted: false });
    expect(terms!.version).toBeGreaterThan(1);

    // Put the repo's text back as the latest, as the migrate step would.
    const owner = ownerDatabase();
    await expect(publishAgreements(owner)).resolves.toEqual(['TERMS']);
    await owner.close();
  });
});
