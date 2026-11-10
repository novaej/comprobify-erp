import { randomUUID } from 'node:crypto';
import {
  addModule,
  billingOverview,
  createKeyCipher,
  fixedClock,
  onboardOrganization,
  removeModule,
  resolveActor,
  reviewPayment,
  startPaidPlan,
  submitProof,
  type ActorContext,
  type CreatedOrganization,
  type PlatformActor,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// FR-BILL-6, ADR-030: a period pays only for the add-ons it keeps to its end. An add-on the
// operator removed stays until the company's next period, so a paid plan started before then
// must not charge a month of it. Placeholders: Emprende 9.90, Guías 5.00, Inventario 15.00.
describe('add-ons leaving during the period they would be charged for', () => {
  const clock = fixedClock('2026-11-05T15:00:00Z');
  let db: Database;
  let operator: PlatformActor;
  let org: CreatedOrganization;
  let ownerId: string;
  const owner = (): Promise<ActorContext> =>
    resolveActor(db, { userId: ownerId, tenantId: org.twinTenantId, clock });

  beforeAll(async () => {
    db = appDatabase();
    operator = { ...(await superAdmin(db)), clock };
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `la.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Tau Kappa S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2026-01-01'),
            notAfter: new Date('2028-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher: createKeyCipher('dc'.repeat(32)), clock },
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('charges a kept add-on, not one already removed, and drops the removed one once paid', async () => {
    const company = { realTenantId: org.realTenantId };
    await addModule(operator, db, { ...company, moduleKey: 'DELIVERY_GUIDES' });
    await addModule(operator, db, { ...company, moduleKey: 'INVENTORY' });
    // Removed on Gratis: it stays until the quota's next month, 5 December.
    clock.set('2026-11-10T15:00:00Z');
    await removeModule(operator, db, { ...company, moduleKey: 'INVENTORY' });
    expect((await owner()).entitlements.features).toContain('INVENTORY');
    // The page says when it leaves: its own date, as Gratis has no period end.
    const view = await billingOverview(await owner(), db);
    expect(view.addOns.find((row) => row.key === 'INVENTORY')).toMatchObject({
      state: 'LEAVING',
      leavesOn: '2026-12-05',
    });

    const initial = await startPaidPlan(await owner(), db, {
      planKey: 'STARTER',
      interval: 'MONTHLY',
    });
    // Emprende 9.90 + Guías 5.00, kept; Inventario leaves on 5 December, inside the month.
    expect(initial).toMatchObject({ baseAmount: '14.90', ivaAmount: '2.24', totalAmount: '17.14' });

    // Paid: the removed add-on goes now, the kept one stays, the plan's own modules too.
    await submitProof(await owner(), db, {
      paymentId: initial.id,
      reference: 'SPI-1',
      files: [{ filename: 'p.png', content: PNG }],
    });
    await reviewPayment(operator, db, { paymentId: initial.id, decision: 'VERIFIED' });
    const features = (await owner()).entitlements.features;
    expect(features).not.toContain('INVENTORY');
    expect(features).toContain('DOC_TYPE_06');
    expect(features).toContain('DOC_TYPE_04');
    // The real company says the same as its test copy: both are written.
    const real = await resolveActor(db, { userId: ownerId, tenantId: org.realTenantId, clock });
    expect(real.entitlements.features).not.toContain('INVENTORY');
  });
});
