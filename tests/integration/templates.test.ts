import { randomUUID } from 'node:crypto';
import {
  createOrganization,
  fixedClock,
  listTemplates,
  removeTemplate,
  resolveActor,
  saveTemplate,
  setOverride,
  type ActorContext,
  type CreatedOrganization,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

// FR-MD-5.
describe('invoice templates', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let org: CreatedOrganization;
  let ownerId: string;

  const owner = (tenantId = org.realTenantId) =>
    resolveActor(db, { userId: ownerId, tenantId, clock });
  const content = (unitPrice = '10') => ({
    clientId: null,
    lines: [
      { code: 'P-1', name: 'Mantenimiento mensual', quantity: '1', unitPrice, ivaRateCode: '4' },
    ],
    payments: [{ method: '20' as const, amount: '11.50' }],
    additionalInfo: [{ name: 'Contrato', value: 'C-12' }],
  });

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `tp.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    org = await createOrganization(db, {
      ownerUserId: ownerId,
      ruc: testRuc(),
      legalName: 'Chi S.A.',
      tradeName: null,
      mainAddress: 'Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
    // Gratis has no templates: the Branding module brings them.
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOCUMENT_TEMPLATES',
      effect: 'GRANT',
      limitValue: null,
      reason: 'test',
    });
  });

  afterAll(() => db.close());

  it('saves and lists templates, the same name replacing the earlier one', async () => {
    const actor = await owner();
    const first = await saveTemplate(actor, db, { name: 'Mensual', content: content('10') });
    expect(first.replaced).toBe(false);
    const again = await saveTemplate(actor, db, { name: 'mensual', content: content('12') });
    expect(again).toEqual({ id: first.id, replaced: true });
    await saveTemplate(actor, db, { name: 'Anual', content: content('100') });

    const templates = await listTemplates(actor, db);
    expect(templates.map((template) => template.name)).toEqual(['Anual', 'mensual']);
    expect(templates[1]!.content).toMatchObject({
      lines: [{ name: 'Mantenimiento mensual', unitPrice: '12', discount: '0' }],
      additionalInfo: [{ name: 'Contrato', value: 'C-12' }],
    });
  });

  it('keeps the test copy’s templates apart, and removes without deleting', async () => {
    const twin = await owner(org.twinTenantId);
    await expect(listTemplates(twin, db)).resolves.toEqual([]);
    const saved = await saveTemplate(twin, db, { name: 'Prueba', content: content() });
    await removeTemplate(twin, db, saved.id);
    await expect(listTemplates(twin, db)).resolves.toEqual([]);
    await expect(removeTemplate(twin, db, saved.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // The name is free again once removed.
    await expect(
      saveTemplate(twin, db, { name: 'Prueba', content: content() }),
    ).resolves.toMatchObject({
      replaced: false,
    });
  });

  it('needs the plan, the role, and content that would issue as it is', async () => {
    const actor = await owner();
    const viewer: ActorContext = { ...actor, permissions: ['documents.read'] };
    await expect(listTemplates(viewer, db)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      saveTemplate(actor, db, {
        name: 'Mala',
        content: { ...content(), lines: [{ ...content().lines[0]!, quantity: '0' }] },
      }),
    ).rejects.toMatchObject({ name: 'ZodError' });

    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOCUMENT_TEMPLATES',
      effect: 'REVOKE',
      limitValue: null,
      reason: 'test',
    });
    await expect(listTemplates(await owner(), db)).rejects.toMatchObject({
      code: 'FEATURE_NOT_ENABLED',
    });
  });
});
