import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  schema,
  sql,
  type Database,
  type PriceKind,
  type Tx,
} from '@comprobify/db';
import { z } from 'zod';
import { recordPlatformAudit } from '../audit';
import { NOTICE_DAYS } from '../entitlements';
import { assertSuperAdmin } from '../identity';
import { addDays, amountInput, Dec, DomainError, ecuadorDate, type PlatformActor } from '../kernel';
import { notify, type NotifyDeps } from '../notifications';
import { STARTING_PRICES, STARTING_PRICES_FROM } from './starting-prices';

// FR-BILL-6 (ADR-027): what plans, add-ons, seats and document packs cost, with their history.

type PriceRow = typeof schema.prices.$inferSelect;

// What a price is for, by its database ids: what later billing steps ask about.
export type PricedThing =
  | { kind: 'PLAN'; planId: string }
  | { kind: 'MODULE'; moduleId: string }
  | { kind: 'SEAT' }
  | { kind: 'PACK'; packSize: number };

// Yearly billing is ten months for twelve (FR-BILL-1).
export const YEARLY_MONTHS = 10;

const sameThing = (thing: PricedThing) => {
  const { prices } = schema;
  return and(
    eq(prices.kind, thing.kind),
    thing.kind === 'PLAN' ? eq(prices.planId, thing.planId) : isNull(prices.planId),
    thing.kind === 'MODULE' ? eq(prices.moduleId, thing.moduleId) : isNull(prices.moduleId),
    thing.kind === 'PACK' ? eq(prices.packSize, thing.packSize) : isNull(prices.packSize),
  );
};

// The price in force on an Ecuador date: the latest published one dated on or before it. Every
// charge asks with the date its period starts, so a published change never reaches a period
// that began before it (Appendix B lesson 3). Null: nothing priced, or a pack no longer sold.
export async function priceOn(tx: Tx['db'], thing: PricedThing, on: string): Promise<Dec | null> {
  const { prices } = schema;
  const [row] = await tx
    .select({ amount: prices.amount })
    .from(prices)
    .where(and(sameThing(thing), eq(prices.status, 'PUBLISHED'), lte(prices.effectiveOn, on)))
    .orderBy(desc(prices.effectiveOn))
    .limit(1);
  return row?.amount == null ? null : new Dec(row.amount);
}

const DRAFT_NOT_FOUND = () => new DomainError('NOT_FOUND', 'Price draft not found');

// The things the platform sells today, each with its prices.
export type PriceLine = {
  kind: PriceKind;
  // The plan's or module's key; null for the seat and a pack.
  key: string | null;
  nameEs: string;
  nameEn: string;
  packSize: number | null;
  current: { amount: string | null; effectiveOn: string } | null;
  upcoming: { amount: string | null; effectiveOn: string }[];
  draft: { id: string; amount: string | null } | null;
  // How many paying companies a rise would reach: they get the notice.
  affected: number;
};

// Who pays for a thing now: what a rise must give notice to. A pack is bought once at the price
// shown, so nobody holds one to protect. Seats count every paying company until extra seats
// exist (Milestone 8, step 4) and can be counted on their own.
async function affectedBy(tx: Tx['db'], thing: PricedThing): Promise<number> {
  const { subscriptions, subscriptionItems } = schema;
  if (thing.kind === 'PACK') return 0;
  const paying = eq(subscriptions.billing, 'PAID');
  const [row] =
    thing.kind === 'PLAN'
      ? await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(subscriptions)
          .where(and(paying, eq(subscriptions.planId, thing.planId)))
      : thing.kind === 'MODULE'
        ? await tx
            .select({ n: sql<number>`count(DISTINCT ${subscriptions.id})::int` })
            .from(subscriptionItems)
            .innerJoin(
              subscriptions,
              and(
                eq(subscriptions.tenantId, subscriptionItems.tenantId),
                eq(subscriptions.id, subscriptionItems.subscriptionId),
              ),
            )
            .where(
              and(
                paying,
                eq(subscriptionItems.kind, 'MODULE'),
                eq(subscriptionItems.active, true),
                eq(subscriptionItems.moduleId, thing.moduleId),
              ),
            )
        : await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(subscriptions)
            .where(paying);
  return row!.n;
}

// The real, active companies a rise reaches, and what to call the thing in each language.
async function risenFor(tx: Tx['db'], thing: PricedThing) {
  const { subscriptions, subscriptionItems, tenants, plans, modules } = schema;
  const real = and(eq(tenants.mode, 'PRODUCTION'), eq(tenants.status, 'ACTIVE'));
  const paying = eq(subscriptions.billing, 'PAID');
  if (thing.kind === 'PACK') return null;
  const [plan] =
    thing.kind === 'PLAN'
      ? await tx.select().from(plans).where(eq(plans.id, thing.planId))
      : [undefined];
  const [module] =
    thing.kind === 'MODULE'
      ? await tx.select().from(modules).where(eq(modules.id, thing.moduleId))
      : [undefined];
  const rows =
    thing.kind === 'MODULE'
      ? await tx
          .select({ id: tenants.id })
          .from(subscriptionItems)
          .innerJoin(
            subscriptions,
            and(
              eq(subscriptions.tenantId, subscriptionItems.tenantId),
              eq(subscriptions.id, subscriptionItems.subscriptionId),
            ),
          )
          .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
          .where(
            and(
              paying,
              real,
              eq(subscriptionItems.kind, 'MODULE'),
              eq(subscriptionItems.active, true),
              eq(subscriptionItems.moduleId, thing.moduleId),
            ),
          )
      : await tx
          .select({ id: tenants.id })
          .from(subscriptions)
          .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
          .where(
            thing.kind === 'PLAN'
              ? and(paying, real, eq(subscriptions.planId, thing.planId))
              : and(paying, real),
          );
  const named = plan ?? module;
  return {
    companies: [...new Set(rows.map((row) => row.id))],
    name: named?.nameEs ?? 'Usuarios adicionales',
    nameEn: named?.nameEn ?? 'Extra users',
  };
}

const thingOf = (row: PriceRow): PricedThing =>
  row.kind === 'PLAN'
    ? { kind: 'PLAN', planId: row.planId! }
    : row.kind === 'MODULE'
      ? { kind: 'MODULE', moduleId: row.moduleId! }
      : row.kind === 'PACK'
        ? { kind: 'PACK', packSize: row.packSize! }
        : { kind: 'SEAT' };

// The price book: self-service plans, add-on modules, the seat and every pack size ever priced.
export async function priceBook(actor: PlatformActor, db: Database): Promise<PriceLine[]> {
  await assertSuperAdmin(db.identity, actor);
  const today = ecuadorDate(actor.clock.now());
  return db.withSystem('super admin: read the price book', async ({ db: tx }) => {
    const { plans, modules, prices } = schema;
    const planRows = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.selfService, true), inArray(plans.status, ['DRAFT', 'PUBLISHED'])))
      .orderBy(asc(plans.sortOrder));
    const moduleRows = await tx
      .select()
      .from(modules)
      .where(and(eq(modules.isBase, false), eq(modules.status, 'AVAILABLE')))
      .orderBy(asc(modules.sortOrder));
    const rows = await tx
      .select()
      .from(prices)
      .where(inArray(prices.status, ['DRAFT', 'PUBLISHED']))
      .orderBy(asc(prices.effectiveOn));
    const packSizes = [
      ...new Set(rows.filter((row) => row.kind === 'PACK').map((row) => row.packSize!)),
    ].sort((a, b) => a - b);

    const line = async (
      thing: PricedThing,
      names: { key: string | null; nameEs: string; nameEn: string },
    ): Promise<PriceLine> => {
      const own = rows.filter(
        (row) =>
          row.kind === thing.kind &&
          row.planId === (thing.kind === 'PLAN' ? thing.planId : null) &&
          row.moduleId === (thing.kind === 'MODULE' ? thing.moduleId : null) &&
          row.packSize === (thing.kind === 'PACK' ? thing.packSize : null),
      );
      const published = own.filter((row) => row.status === 'PUBLISHED');
      const current = published.filter((row) => row.effectiveOn! <= today).at(-1);
      const draft = own.find((row) => row.status === 'DRAFT');
      return {
        kind: thing.kind,
        ...names,
        packSize: thing.kind === 'PACK' ? thing.packSize : null,
        current: current ? { amount: current.amount, effectiveOn: current.effectiveOn! } : null,
        upcoming: published
          .filter((row) => row.effectiveOn! > today)
          .map((row) => ({ amount: row.amount, effectiveOn: row.effectiveOn! })),
        draft: draft ? { id: draft.id, amount: draft.amount } : null,
        affected: await affectedBy(tx, thing),
      };
    };

    const lines: PriceLine[] = [];
    for (const plan of planRows)
      lines.push(
        await line(
          { kind: 'PLAN', planId: plan.id },
          { key: plan.key, nameEs: plan.nameEs, nameEn: plan.nameEn },
        ),
      );
    for (const module of moduleRows)
      lines.push(
        await line(
          { kind: 'MODULE', moduleId: module.id },
          { key: module.key, nameEs: module.nameEs, nameEn: module.nameEn },
        ),
      );
    lines.push(
      await line(
        { kind: 'SEAT' },
        { key: null, nameEs: 'Usuario adicional', nameEn: 'Extra user' },
      ),
    );
    for (const size of packSizes)
      lines.push(
        await line(
          { kind: 'PACK', packSize: size },
          { key: null, nameEs: `Paquete de ${size}`, nameEn: `Pack of ${size}` },
        ),
      );
    return lines;
  });
}

const key = z.string().regex(/^[A-Z][A-Z0-9_]{2,39}$/);

export const draftPriceInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PLAN'), planKey: key, amount: amountInput }),
  z.object({ kind: z.literal('MODULE'), moduleKey: key, amount: amountInput }),
  z.object({ kind: z.literal('SEAT'), amount: amountInput }),
  // A null amount stops selling the pack from the date it is published.
  z.object({
    kind: z.literal('PACK'),
    packSize: z.int().min(1).max(1_000_000),
    amount: amountInput.nullable(),
  }),
]);
export type DraftPriceInput = z.input<typeof draftPriceInput>;

async function thingFor(
  tx: Tx['db'],
  input: z.output<typeof draftPriceInput>,
): Promise<PricedThing> {
  if (input.kind === 'PLAN') {
    const [plan] = await tx
      .select({ id: schema.plans.id, selfService: schema.plans.selfService })
      .from(schema.plans)
      .where(eq(schema.plans.key, input.planKey));
    if (!plan) throw new DomainError('NOT_FOUND', 'Plan not found');
    // Personalizado's price is negotiated per company (FR-PLAN-1a).
    if (!plan.selfService)
      throw new DomainError('PLAN_NOT_PRICED', 'A plan set up by the operator has no list price');
    return { kind: 'PLAN', planId: plan.id };
  }
  if (input.kind === 'MODULE') {
    const [module] = await tx
      .select({ id: schema.modules.id, isBase: schema.modules.isBase })
      .from(schema.modules)
      .where(eq(schema.modules.key, input.moduleKey));
    if (!module) throw new DomainError('NOT_FOUND', 'Module not found');
    // The base module is part of every plan, never sold on its own.
    if (module.isBase)
      throw new DomainError('PLAN_NOT_PRICED', 'The base module is part of every plan');
    return { kind: 'MODULE', moduleId: module.id };
  }
  return input.kind === 'PACK' ? { kind: 'PACK', packSize: input.packSize } : { kind: 'SEAT' };
}

const columnsOf = (thing: PricedThing) => ({
  kind: thing.kind,
  planId: thing.kind === 'PLAN' ? thing.planId : null,
  moduleId: thing.kind === 'MODULE' ? thing.moduleId : null,
  packSize: thing.kind === 'PACK' ? thing.packSize : null,
});

// The thing's draft, new or changed: nothing reaches a company until it is published.
export async function draftPrice(
  actor: PlatformActor,
  db: Database,
  raw: DraftPriceInput,
): Promise<{ id: string }> {
  await assertSuperAdmin(db.identity, actor);
  const input = draftPriceInput.parse(raw);
  return db.withSystem('super admin: draft a price', async ({ db: tx }) => {
    const thing = await thingFor(tx, input);
    const [existing] = await tx
      .select({ id: schema.prices.id })
      .from(schema.prices)
      .where(and(sameThing(thing), eq(schema.prices.status, 'DRAFT')))
      .for('update');
    const [row] = existing
      ? await tx
          .update(schema.prices)
          .set({ amount: input.amount })
          .where(eq(schema.prices.id, existing.id))
          .returning({ id: schema.prices.id })
      : await tx
          .insert(schema.prices)
          .values({ ...columnsOf(thing), amount: input.amount, createdBy: actor.userId })
          .returning({ id: schema.prices.id });
    await recordPlatformAudit(tx, {
      actorUserId: actor.userId,
      action: 'price.drafted',
      details: { kind: thing.kind, priceId: row!.id, amount: input.amount },
    });
    return row!;
  });
}

async function lockDraft(tx: Tx['db'], id: string): Promise<PriceRow> {
  const [row] = await tx.select().from(schema.prices).where(eq(schema.prices.id, id)).for('update');
  if (!row || row.status !== 'DRAFT') throw DRAFT_NOT_FOUND();
  return row;
}

export async function discardPrice(actor: PlatformActor, db: Database, id: string): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  const priceId = z.uuid().parse(id);
  await db.withSystem('super admin: discard a price draft', async ({ db: tx }) => {
    const row = await lockDraft(tx, priceId);
    await tx.update(schema.prices).set({ status: 'DISCARDED' }).where(eq(schema.prices.id, row.id));
    await recordPlatformAudit(tx, {
      actorUserId: actor.userId,
      action: 'price.discarded',
      details: { kind: row.kind, priceId: row.id },
    });
  });
}

// The earliest date a draft can take effect. A rise over what companies pay today reaches paying
// companies only after NOTICE_DAYS (FR-BILL-6); a cut, a first price, a pack, or a thing nobody
// pays for yet takes effect today, so the real prices can replace the placeholders at once
// before launch. Compared with today's price, not a scheduled one: a draft under an announced
// rise is still a rise over what is paid now.
export async function earliestEffectiveOn(
  tx: Tx['db'],
  row: PriceRow,
  today: string,
): Promise<{ on: string; notice: boolean }> {
  const thing = thingOf(row);
  const now = await priceOn(tx, thing, today);
  const rise = now !== null && (row.amount === null || new Dec(row.amount).gt(now));
  const notice = rise && (await affectedBy(tx, thing)) > 0;
  return { on: notice ? addDays(today, NOTICE_DAYS) : today, notice };
}

export const publishPriceInput = z.object({
  id: z.uuid(),
  // Ecuador date; the earliest allowed when left out.
  effectiveOn: z.iso.date().nullable().default(null),
});
export type PublishPriceInput = z.input<typeof publishPriceInput>;

export async function publishPrice(
  actor: PlatformActor,
  db: Database,
  raw: PublishPriceInput,
  notice: NotifyDeps,
): Promise<{ effectiveOn: string; notice: boolean }> {
  await assertSuperAdmin(db.identity, actor);
  const input = publishPriceInput.parse(raw);
  const today = ecuadorDate(actor.clock.now());
  return db.withSystem('super admin: publish a price', async (full) => {
    const tx = full.db;
    const row = await lockDraft(tx, input.id);
    // Two drafts published at once can't both decide their notice from the same latest price.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('prices'))`);
    const earliest = await earliestEffectiveOn(tx, row, today);
    const effectiveOn = input.effectiveOn ?? earliest.on;
    if (effectiveOn < earliest.on)
      throw new DomainError('PRICE_NOTICE_TOO_SHORT', 'This price needs more notice', {
        earliest: earliest.on,
      });
    const taken = await tx
      .select({ id: schema.prices.id })
      .from(schema.prices)
      .where(
        and(
          sameThing(thingOf(row)),
          eq(schema.prices.status, 'PUBLISHED'),
          eq(schema.prices.effectiveOn, effectiveOn),
        ),
      );
    if (taken.length > 0)
      throw new DomainError('PRICE_DATE_TAKEN', 'Another price starts on that date', {
        effectiveOn,
      });
    await tx
      .update(schema.prices)
      .set({
        status: 'PUBLISHED',
        effectiveOn,
        publishedAt: actor.clock.now(),
        publishedBy: actor.userId,
      })
      .where(eq(schema.prices.id, row.id));
    await recordPlatformAudit(tx, {
      actorUserId: actor.userId,
      action: 'price.published',
      details: {
        kind: row.kind,
        priceId: row.id,
        amount: row.amount,
        effectiveOn,
        notice: earliest.notice,
      },
    });
    // FR-BILL-6: a rise that reaches paying companies is told to them, and they can't turn it off.
    if (earliest.notice) {
      const reached = await risenFor(tx, thingOf(row));
      if (reached)
        for (const tenantId of reached.companies)
          await notify(full, notice, {
            tenantId,
            type: 'PRICE_RISE',
            params: { name: reached.name, nameEn: reached.nameEn, date: effectiveOn },
          });
    }
    return { effectiveOn, notice: earliest.notice };
  });
}

// ADR-027: the placeholders, for whatever has no price at all yet. Run by the migrate step
// after the catalog sync; it never touches a price the super admin has set.
export async function syncPrices(db: Database): Promise<string[]> {
  return db.withSystem('seed placeholder prices', async ({ db: tx }) => {
    const { plans, modules, prices } = schema;
    const added: string[] = [];
    const seed = async (thing: PricedThing, amount: string, label: string) => {
      const [any] = await tx
        .select({ id: prices.id })
        .from(prices)
        .where(sameThing(thing))
        .limit(1);
      if (any) return;
      await tx.insert(prices).values({
        ...columnsOf(thing),
        amount,
        status: 'PUBLISHED',
        effectiveOn: STARTING_PRICES_FROM,
        publishedAt: new Date(),
      });
      added.push(label);
    };
    for (const plan of await tx.select().from(plans)) {
      const amount = (STARTING_PRICES.plans as Record<string, string>)[plan.key];
      if (amount) await seed({ kind: 'PLAN', planId: plan.id }, amount, plan.key);
    }
    for (const module of await tx.select().from(modules)) {
      const amount = (STARTING_PRICES.modules as Record<string, string>)[module.key];
      if (amount) await seed({ kind: 'MODULE', moduleId: module.id }, amount, module.key);
    }
    await seed({ kind: 'SEAT' }, STARTING_PRICES.seat, 'SEAT');
    // Packs only on the first run: once any exists, the sizes are the super admin's.
    const [anyPack] = await tx
      .select({ id: prices.id })
      .from(prices)
      .where(eq(prices.kind, 'PACK'))
      .limit(1);
    if (!anyPack)
      for (const [size, amount] of Object.entries(STARTING_PRICES.packs))
        await seed({ kind: 'PACK', packSize: Number(size) }, amount, `PACK_${size}`);
    return added;
  });
}
