import { and, desc, eq, isNull, lte, schema, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { recordPlatformAudit } from '../audit';
import { assertSuperAdmin } from '../identity';
import { DomainError, ecuadorDate, type PlatformActor } from '../kernel';

// FR-BILL-2 (ADR-034): the IVA on subscriptions, by date. The law sets a new rate and the day it
// starts; the operator records it ahead, and every payment created from that day charges it.

// The rate in force on an Ecuador date, such as "15.00".
export async function ivaRateOn(tx: Tx['db'], on: string): Promise<string> {
  const { ivaRates } = schema;
  const [row] = await tx
    .select({ rate: ivaRates.rate })
    .from(ivaRates)
    .where(and(lte(ivaRates.effectiveOn, on), isNull(ivaRates.withdrawnAt)))
    .orderBy(desc(ivaRates.effectiveOn))
    .limit(1);
  // The migration seeds the first one, so this is a broken database, not a user error.
  if (!row) throw new Error(`No IVA rate in force on ${on}`);
  return row.rate;
}

export type IvaRateLine = {
  id: string;
  rate: string;
  effectiveOn: string;
  // In force now, past, or still to come; a withdrawn one never applied.
  state: 'CURRENT' | 'PAST' | 'SCHEDULED' | 'WITHDRAWN';
};

export async function ivaRates(actor: PlatformActor, db: Database): Promise<IvaRateLine[]> {
  await assertSuperAdmin(db.identity, actor);
  const today = ecuadorDate(actor.clock.now());
  return db.withSystem('super admin: IVA rates', async ({ db: tx }) => {
    const rows = await tx.select().from(schema.ivaRates).orderBy(desc(schema.ivaRates.effectiveOn));
    // Newest first: the first one in force by today is the current one.
    let current = false;
    return rows.map((row) => {
      let state: IvaRateLine['state'];
      if (row.withdrawnAt) state = 'WITHDRAWN';
      else if (row.effectiveOn > today) state = 'SCHEDULED';
      else if (!current) {
        state = 'CURRENT';
        current = true;
      } else state = 'PAST';
      return { id: row.id, rate: row.rate, effectiveOn: row.effectiveOn, state };
    });
  });
}

export const scheduleIvaInput = z.object({
  rate: z
    .string()
    .trim()
    .regex(/^\d{1,2}(\.\d{1,2})?$/),
  effectiveOn: z.iso.date(),
});

// A new rate from a day on, today at the earliest: what was charged before stays as it was.
export async function scheduleIvaRate(
  actor: PlatformActor,
  db: Database,
  raw: z.input<typeof scheduleIvaInput>,
): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  const input = scheduleIvaInput.parse(raw);
  const today = ecuadorDate(actor.clock.now());
  if (input.effectiveOn < today)
    throw new DomainError('IVA_DATE_PAST', 'A rate starts today at the earliest');
  await db.withSystem('super admin: schedule an IVA rate', async ({ db: tx }) => {
    const [taken] = await tx
      .select({ id: schema.ivaRates.id })
      .from(schema.ivaRates)
      .where(
        and(
          eq(schema.ivaRates.effectiveOn, input.effectiveOn),
          isNull(schema.ivaRates.withdrawnAt),
        ),
      );
    if (taken) throw new DomainError('IVA_DATE_TAKEN', 'Another rate starts that day');
    await tx
      .insert(schema.ivaRates)
      .values({ rate: input.rate, effectiveOn: input.effectiveOn, createdBy: actor.userId });
    await recordPlatformAudit(tx, {
      actorUserId: actor.userId,
      action: 'iva.scheduled',
      details: { rate: input.rate, effectiveOn: input.effectiveOn },
    });
  });
}

// A rate recorded by mistake, before its day comes. One already in force is history.
export async function withdrawIvaRate(
  actor: PlatformActor,
  db: Database,
  id: string,
): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  const rateId = z.uuid().parse(id);
  const today = ecuadorDate(actor.clock.now());
  await db.withSystem('super admin: withdraw an IVA rate', async ({ db: tx }) => {
    const [row] = await tx
      .select()
      .from(schema.ivaRates)
      .where(eq(schema.ivaRates.id, rateId))
      .for('update');
    if (!row) throw new DomainError('NOT_FOUND', 'IVA rate not found');
    if (row.withdrawnAt || row.effectiveOn <= today)
      throw new DomainError('IVA_NOT_WITHDRAWABLE', 'Only a rate still to come is withdrawn');
    await tx
      .update(schema.ivaRates)
      .set({ withdrawnAt: actor.clock.now(), withdrawnBy: actor.userId })
      .where(eq(schema.ivaRates.id, row.id));
    await recordPlatformAudit(tx, {
      actorUserId: actor.userId,
      action: 'iva.withdrawn',
      details: { rate: row.rate, effectiveOn: row.effectiveOn },
    });
  });
}
