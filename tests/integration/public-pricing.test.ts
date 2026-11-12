import { randomUUID } from 'node:crypto';
import {
  createPlan,
  draftPrice,
  publicPricing,
  publishPrice,
  STARTING_PRICES,
  updatePlan,
  type PlatformActor,
} from '@comprobify/core';
import { type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin, testNotice } from './helpers';

// FR-UX-5: the public pricing page reads the prices and plans the platform edits.
describe('public pricing', () => {
  const now = new Date('2026-11-10T15:00:00Z');
  let db: Database;
  let admin: PlatformActor;
  let planKey: string;

  const plan = async () => (await publicPricing(db, now)).plans.find((p) => p.key === planKey);

  beforeAll(async () => {
    db = appDatabase();
    admin = { ...(await superAdmin(db)), clock: { now: () => now } };
    planKey = `PP_${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
    await createPlan(admin, db, {
      key: planKey,
      nameEs: 'Pública',
      nameEn: 'Public',
      selfService: true,
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('lists the starting plans at their placeholder prices, yearly at ten months', async () => {
    const { plans, addOns, seatMonthly } = await publicPricing(db, now);
    const starter = plans.find((p) => p.key === 'STARTER')!;
    expect(starter.monthly).toBe(STARTING_PRICES.plans.STARTER);
    expect(starter.yearly).toBe((Number(STARTING_PRICES.plans.STARTER) * 10).toFixed(2));
    expect(starter.limits.documents).toBe(50);
    expect(starter.modules.map((m) => m.key)).toEqual(
      expect.arrayContaining(['INVOICING', 'CREDIT_NOTES']),
    );
    expect(plans.find((p) => p.key === 'FREE')!.monthly).toBe('0.00');
    // Personalizado is set up by the operator, never listed.
    expect(plans.map((p) => p.key)).not.toContain('CUSTOM');
    expect(addOns.map((a) => a.key)).toContain('INVENTORY');
    expect(addOns.map((a) => a.key)).not.toContain('INVOICING');
    expect(seatMonthly).toBe(STARTING_PRICES.seat);
  });

  it('shows a plan only once it is published and priced, and follows a price change', async () => {
    expect(await plan()).toBeUndefined();
    await updatePlan(admin, db, {
      key: planKey,
      nameEs: 'Pública',
      nameEn: 'Public',
      selfService: true,
      status: 'PUBLISHED',
    });
    // Published but with no price: not offered at a made-up one.
    expect(await plan()).toBeUndefined();
    const first = await draftPrice(admin, db, { kind: 'PLAN', planKey, amount: '10.00' });
    // A draft reaches nobody.
    expect(await plan()).toBeUndefined();
    await publishPrice(admin, db, { id: first.id }, testNotice);
    expect(await plan()).toMatchObject({ monthly: '10.00', yearly: '100.00', upcoming: null });

    const rise = await draftPrice(admin, db, { kind: 'PLAN', planKey, amount: '12.00' });
    await publishPrice(admin, db, { id: rise.id, effectiveOn: '2026-11-11' }, testNotice);
    // The current price holds until the date, and the page can announce what is coming.
    expect(await plan()).toMatchObject({
      monthly: '10.00',
      upcoming: { monthly: '12.00', on: '2026-11-11' },
    });
    const tomorrow = await publicPricing(db, new Date('2026-11-11T15:00:00Z'));
    expect(tomorrow.plans.find((p) => p.key === planKey)).toMatchObject({
      monthly: '12.00',
      upcoming: null,
    });
  });
});
