import { randomInt } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  PAYMENT_REJECTION_REASONS,
  schema,
  sql,
  type Database,
  type PaymentPurpose,
  type PaymentRejectionReason,
  type PaymentStatus,
  type Tx,
} from '@comprobify/db';
import { z } from 'zod';
import { recordAudit } from '../audit';
import {
  applySubscriptionTerm,
  periodEndFrom,
  type CompanyTenants,
  type SubscriptionTerm,
} from '../entitlements';
import { assertSuperAdmin } from '../identity';
import {
  Dec,
  DomainError,
  ecuadorDate,
  money,
  requirePermission,
  type ActorContext,
  type PlatformActor,
} from '../kernel';
import { companyRow, realTenantOf } from '../tenancy';
import { priceOn, YEARLY_MONTHS } from './prices';

// FR-BILL-2, FR-BILL-3, FR-BILL-4, FR-BILL-8 (ADR-029): payments, their proofs and their review.

// What billing needs from the deployment: the IVA rate, a percent such as "15" (IVA_RATE).
export type BillingDeps = { ivaRate: string };

export const PROOF_MAX_BYTES = 2 * 1024 * 1024;
export const PROOFS_PER_SUBMISSION = 5;
export const ACTIVE_PROOFS_PER_PAYMENT = 10;
// Still waiting on the company or the operator: what blocks starting another.
const OPEN: PaymentStatus[] = ['PENDING', 'REPORTED', 'REJECTED'];

// No 0/O, 1/I/L: the code is read off a screen and typed into a bank transfer by hand.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const paymentCode = (): string =>
  `CB-${Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')}`;

// IVA on top of a base before IVA, each rounded to the cent; the total is their sum.
export function amountsOf(base: Dec, ivaRate: string) {
  const baseAmount = money(base);
  const ivaAmount = money(baseAmount.mul(ivaRate).div(100));
  return {
    baseAmount: baseAmount.toFixed(2),
    ivaRate: new Dec(ivaRate).toFixed(2),
    ivaAmount: ivaAmount.toFixed(2),
    totalAmount: baseAmount.add(ivaAmount).toFixed(2),
  };
}

type PaymentRow = typeof schema.payments.$inferSelect;

export type PaymentView = {
  id: string;
  code: string;
  purpose: PaymentPurpose;
  status: PaymentStatus;
  method: PaymentRow['method'];
  baseAmount: string;
  ivaRate: string;
  ivaAmount: string;
  totalAmount: string;
  targetPlan: { key: string; nameEs: string; nameEn: string } | null;
  targetInterval: PaymentRow['targetInterval'];
  periodStart: string | null;
  periodEnd: string | null;
  rejectionReason: PaymentRejectionReason | null;
  createdAt: Date;
  reportedAt: Date | null;
  verifiedAt: Date | null;
};

export type ProofView = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  reference: string;
  active: boolean;
  createdAt: Date;
};

async function viewsOf(tx: Tx['db'], rows: PaymentRow[]): Promise<PaymentView[]> {
  const planIds = [...new Set(rows.flatMap((row) => (row.targetPlanId ? [row.targetPlanId] : [])))];
  const plans = planIds.length
    ? await tx.select().from(schema.plans).where(inArray(schema.plans.id, planIds))
    : [];
  return rows.map((row) => {
    const plan = plans.find((candidate) => candidate.id === row.targetPlanId);
    return {
      id: row.id,
      code: row.code,
      purpose: row.purpose,
      status: row.status,
      method: row.method,
      baseAmount: row.baseAmount,
      ivaRate: row.ivaRate,
      ivaAmount: row.ivaAmount,
      totalAmount: row.totalAmount,
      targetPlan: plan ? { key: plan.key, nameEs: plan.nameEs, nameEn: plan.nameEn } : null,
      targetInterval: row.targetInterval,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      rejectionReason: row.rejectionReason,
      createdAt: row.createdAt,
      reportedAt: row.reportedAt,
      verifiedAt: row.verifiedAt,
    };
  });
}

const proofView = (row: typeof schema.paymentProofs.$inferSelect): ProofView => ({
  id: row.id,
  filename: row.filename,
  contentType: row.contentType,
  size: row.size,
  reference: row.reference,
  active: row.active,
  createdAt: row.createdAt,
});

// Payments live in the real company; a member working in the twin reaches them there.
async function inCompany<T>(
  ctx: ActorContext,
  db: Database,
  fn: (tx: Tx, realTenantId: string) => Promise<T>,
): Promise<T> {
  const realTenantId = await realTenantOf(ctx, db);
  return db.withTenant({ tenantId: realTenantId }, (tx) => fn(tx, realTenantId));
}

async function subscriptionOf(tx: Tx['db'], tenantId: string) {
  const [row] = await tx
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, tenantId))
    .for('update');
  if (!row) throw new Error(`Tenant ${tenantId} has no subscription`);
  return row;
}

async function lockPayment(tx: Tx['db'], id: string): Promise<PaymentRow> {
  const [row] = await tx
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.id, id))
    .for('update');
  if (!row) throw new DomainError('NOT_FOUND', 'Payment not found');
  return row;
}

// What the company pays a month on a plan: the plan and each add-on it carries, at their prices
// on the day the period starts (FR-BILL-6).
async function monthlyCharge(
  tx: Tx['db'],
  subscriptionId: string,
  planId: string,
  on: string,
): Promise<{ total: Dec; lines: { kind: string; key: string; monthly: string }[] }> {
  const [plan] = await tx.select().from(schema.plans).where(eq(schema.plans.id, planId));
  const planPrice = await priceOn(tx, { kind: 'PLAN', planId }, on);
  if (!plan || planPrice === null) throw new DomainError('PLAN_NOT_SOLD', 'That plan has no price');
  const lines = [{ kind: 'PLAN', key: plan.key, monthly: planPrice.toFixed(2) }];
  const addOns = await tx
    .select({ moduleId: schema.subscriptionItems.moduleId, key: schema.modules.key })
    .from(schema.subscriptionItems)
    .innerJoin(schema.modules, eq(schema.modules.id, schema.subscriptionItems.moduleId))
    .where(
      and(
        eq(schema.subscriptionItems.subscriptionId, subscriptionId),
        eq(schema.subscriptionItems.kind, 'MODULE'),
        eq(schema.subscriptionItems.active, true),
      ),
    );
  let total = planPrice;
  for (const addOn of addOns) {
    const price = await priceOn(tx, { kind: 'MODULE', moduleId: addOn.moduleId! }, on);
    if (price === null) continue;
    total = total.add(price);
    lines.push({ kind: 'MODULE', key: addOn.key, monthly: price.toFixed(2) });
  }
  return { total, lines };
}

export const startPaidPlanInput = z.object({
  planKey: z.string().regex(/^[A-Z][A-Z0-9_]{2,39}$/),
  interval: z.enum(['MONTHLY', 'YEARLY']),
});
export type StartPaidPlanInput = z.input<typeof startPaidPlanInput>;

// FR-BILL-1: a company that isn't billed asks for a paid plan. Nothing changes until the payment
// is verified (ADR-027 of the old system: payment grants access, the invoice follows).
export async function startPaidPlan(
  ctx: ActorContext,
  db: Database,
  raw: StartPaidPlanInput,
  deps: BillingDeps,
): Promise<PaymentView> {
  requirePermission(ctx, 'billing.manage');
  const input = startPaidPlanInput.parse(raw);
  const today = ecuadorDate(ctx.clock.now());
  return inCompany(ctx, db, async (tx, tenantId) => {
    const subscription = await subscriptionOf(tx.db, tenantId);
    if (subscription.billing === 'COMPLIMENTARY')
      throw new DomainError(
        'SUBSCRIPTION_COMPLIMENTARY',
        'A complimentary company is never charged',
      );
    if (subscription.periodEnd !== null)
      throw new DomainError('ALREADY_BILLED', 'The company already pays for a plan');
    const [plan] = await tx.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.key, input.planKey));
    if (!plan || plan.status !== 'PUBLISHED' || !plan.selfService)
      throw new DomainError('PLAN_NOT_SOLD', 'That plan is not sold');
    const open = await tx.db
      .select({ id: schema.payments.id })
      .from(schema.payments)
      .where(and(eq(schema.payments.tenantId, tenantId), inArray(schema.payments.status, OPEN)));
    if (open.length > 0)
      throw new DomainError('PAYMENT_IN_PROGRESS', 'Another payment is still open');
    const monthly = await monthlyCharge(tx.db, subscription.id, plan.id, today);
    if (!monthly.total.gt(0)) throw new DomainError('PLAN_NOT_SOLD', 'That plan costs nothing');
    const months = input.interval === 'YEARLY' ? YEARLY_MONTHS : 1;
    const [row] = await tx.db
      .insert(schema.payments)
      .values({
        tenantId,
        subscriptionId: subscription.id,
        code: paymentCode(),
        purpose: 'INITIAL',
        ...amountsOf(monthly.total.mul(months), deps.ivaRate),
        targetPlanId: plan.id,
        targetInterval: input.interval,
        pricing: { lines: monthly.lines, months, on: today },
        createdBy: ctx.userId ?? null,
      })
      .returning();
    await recordAudit(tx.db, {
      tenantId,
      actorUserId: ctx.userId ?? null,
      action: 'payment.created',
      details: { code: row!.code, purpose: 'INITIAL', plan: plan.key, interval: input.interval },
    });
    return (await viewsOf(tx.db, [row!]))[0]!;
  });
}

// The renewal of a billed period, at the prices on the day the next period starts (FR-BILL-6).
// Opened by the daily job ahead of the end (Milestone 8, step 5), in its transaction.
export async function openRenewal(
  tx: Tx['db'],
  tenantId: string,
  deps: BillingDeps,
): Promise<PaymentRow | null> {
  const subscription = await subscriptionOf(tx, tenantId);
  if (subscription.billing === 'COMPLIMENTARY' || subscription.periodEnd === null) return null;
  const [open] = await tx
    .select({ id: schema.payments.id })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.tenantId, tenantId),
        eq(schema.payments.purpose, 'RENEWAL'),
        inArray(schema.payments.status, OPEN),
      ),
    );
  if (open) return null;
  const monthly = await monthlyCharge(
    tx,
    subscription.id,
    subscription.planId,
    subscription.periodEnd,
  );
  const months = subscription.interval === 'YEARLY' ? YEARLY_MONTHS : 1;
  const [row] = await tx
    .insert(schema.payments)
    .values({
      tenantId,
      subscriptionId: subscription.id,
      code: paymentCode(),
      purpose: 'RENEWAL',
      ...amountsOf(monthly.total.mul(months), deps.ivaRate),
      pricing: { lines: monthly.lines, months, on: subscription.periodEnd },
    })
    .returning();
  await recordAudit(tx, {
    tenantId,
    actorUserId: null,
    action: 'payment.created',
    details: { code: row!.code, purpose: 'RENEWAL' },
  });
  return row!;
}

export async function listPayments(ctx: ActorContext, db: Database): Promise<PaymentView[]> {
  requirePermission(ctx, 'billing.read');
  return inCompany(ctx, db, async (tx) =>
    viewsOf(
      tx.db,
      await tx.db.select().from(schema.payments).orderBy(desc(schema.payments.createdAt)),
    ),
  );
}

export async function getPayment(
  ctx: ActorContext,
  db: Database,
  id: string,
): Promise<PaymentView & { proofs: ProofView[] }> {
  requirePermission(ctx, 'billing.read');
  const paymentId = z.uuid().parse(id);
  return inCompany(ctx, db, async (tx) => {
    const [row] = await tx.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId));
    if (!row) throw new DomainError('NOT_FOUND', 'Payment not found');
    // A file the company took out is gone from its own view; the operator still sees it.
    const proofs = await tx.db
      .select()
      .from(schema.paymentProofs)
      .where(and(eq(schema.paymentProofs.paymentId, row.id), eq(schema.paymentProofs.active, true)))
      .orderBy(asc(schema.paymentProofs.createdAt));
    return { ...(await viewsOf(tx.db, [row]))[0]!, proofs: proofs.map(proofView) };
  });
}

// PNG, JPEG, GIF or PDF, by its first bytes, never by its name.
export function sniffProof(content: Buffer): string {
  if (content.length === 0 || content.length > PROOF_MAX_BYTES)
    throw new DomainError('PROOF_INVALID', 'Each file must be at most 2 MB');
  const starts = (bytes: number[]) => bytes.every((byte, index) => content[index] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  const head = content.subarray(0, 6).toString('ascii');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (head.startsWith('%PDF-')) return 'application/pdf';
  throw new DomainError('PROOF_INVALID', 'A proof must be a PNG, JPEG or GIF image or a PDF');
}

export const submitProofInput = z.object({
  paymentId: z.uuid(),
  // The bank's reference for the transfer.
  reference: z.string().trim().min(3).max(60),
  files: z
    .array(z.object({ filename: z.string().trim().min(1).max(200), content: z.instanceof(Buffer) }))
    .min(1)
    .max(PROOFS_PER_SUBMISSION),
});
export type SubmitProofInput = z.input<typeof submitProofInput>;

// FR-BILL-3: the company reports its transfer with proof, which the operator reviews. A rejected
// payment can be reported again; files are added, never replaced.
export async function submitProof(
  ctx: ActorContext,
  db: Database,
  raw: SubmitProofInput,
): Promise<void> {
  requirePermission(ctx, 'billing.manage');
  const input = submitProofInput.parse(raw);
  const files = input.files.map((file) => ({ ...file, contentType: sniffProof(file.content) }));
  await inCompany(ctx, db, async (tx, tenantId) => {
    const payment = await lockPayment(tx.db, input.paymentId);
    if (!OPEN.includes(payment.status))
      throw new DomainError('PAYMENT_NOT_OPEN', 'This payment takes no more proof', {
        status: payment.status,
      });
    const [active] = await tx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.paymentProofs)
      .where(
        and(eq(schema.paymentProofs.paymentId, payment.id), eq(schema.paymentProofs.active, true)),
      );
    if (active!.n + files.length > ACTIVE_PROOFS_PER_PAYMENT)
      throw new DomainError('PROOF_LIMIT_REACHED', 'Remove an earlier file first', {
        limit: ACTIVE_PROOFS_PER_PAYMENT,
      });
    await tx.db.insert(schema.paymentProofs).values(
      files.map((file) => ({
        tenantId,
        paymentId: payment.id,
        filename: file.filename,
        contentType: file.contentType,
        content: file.content,
        size: file.content.length,
        reference: input.reference,
        createdBy: ctx.userId ?? null,
      })),
    );
    await tx.db
      .update(schema.payments)
      .set({
        status: 'REPORTED',
        method: 'SPI_TRANSFER',
        reportedAt: ctx.clock.now(),
        rejectionReason: null,
      })
      .where(eq(schema.payments.id, payment.id));
    await recordAudit(tx.db, {
      tenantId,
      actorUserId: ctx.userId ?? null,
      action: 'payment.reported',
      details: { code: payment.code, files: files.length, reference: input.reference },
    });
  });
}

export async function removeProof(
  ctx: ActorContext,
  db: Database,
  input: { paymentId: string; proofId: string },
): Promise<void> {
  requirePermission(ctx, 'billing.manage');
  const ids = z.object({ paymentId: z.uuid(), proofId: z.uuid() }).parse(input);
  await inCompany(ctx, db, async (tx) => {
    const payment = await lockPayment(tx.db, ids.paymentId);
    if (!OPEN.includes(payment.status))
      throw new DomainError('PAYMENT_NOT_OPEN', 'Its proof can no longer change');
    const removed = await tx.db
      .update(schema.paymentProofs)
      .set({ active: false, removedAt: ctx.clock.now() })
      .where(
        and(
          eq(schema.paymentProofs.id, ids.proofId),
          eq(schema.paymentProofs.paymentId, payment.id),
          eq(schema.paymentProofs.active, true),
        ),
      )
      .returning({ id: schema.paymentProofs.id });
    if (removed.length === 0) throw new DomainError('NOT_FOUND', 'Proof not found');
  });
}

// The company backs out of a payment it hasn't sent, or one the operator rejected. A renewal
// stays: the period it pays for is owed either way.
export async function cancelPayment(ctx: ActorContext, db: Database, id: string): Promise<void> {
  requirePermission(ctx, 'billing.manage');
  const paymentId = z.uuid().parse(id);
  await inCompany(ctx, db, async (tx, tenantId) => {
    const payment = await lockPayment(tx.db, paymentId);
    if (payment.purpose === 'RENEWAL' || !['PENDING', 'REJECTED'].includes(payment.status))
      throw new DomainError('PAYMENT_NOT_CANCELLABLE', 'This payment can not be cancelled', {
        status: payment.status,
      });
    await tx.db
      .update(schema.payments)
      .set({ status: 'CANCELLED', cancelledAt: ctx.clock.now() })
      .where(eq(schema.payments.id, payment.id));
    await recordAudit(tx.db, {
      tenantId,
      actorUserId: ctx.userId ?? null,
      action: 'payment.cancelled',
      details: { code: payment.code },
    });
  });
}

export type ProofFile = { filename: string; contentType: string; content: Buffer };

async function proofFrom(
  tx: Tx['db'],
  paymentId: string,
  proofId: string,
  onlyActive: boolean,
): Promise<ProofFile> {
  const [row] = await tx
    .select()
    .from(schema.paymentProofs)
    .where(
      and(
        eq(schema.paymentProofs.id, proofId),
        eq(schema.paymentProofs.paymentId, paymentId),
        onlyActive ? eq(schema.paymentProofs.active, true) : undefined,
      ),
    );
  if (!row) throw new DomainError('NOT_FOUND', 'Proof not found');
  return { filename: row.filename, contentType: row.contentType, content: row.content };
}

export async function proofFile(
  ctx: ActorContext,
  db: Database,
  input: { paymentId: string; proofId: string },
): Promise<ProofFile> {
  requirePermission(ctx, 'billing.read');
  const ids = z.object({ paymentId: z.uuid(), proofId: z.uuid() }).parse(input);
  return inCompany(ctx, db, (tx) => proofFrom(tx.db, ids.paymentId, ids.proofId, true));
}

// --- The operator's side, in the platform area (FR-ADM-2). ---

export type ReviewRow = PaymentView & {
  realTenantId: string;
  company: { name: string; ruc: string };
  proofs: number;
};

export async function paymentsToReview(
  actor: PlatformActor,
  db: Database,
  filter: { status?: PaymentStatus } = {},
): Promise<ReviewRow[]> {
  await assertSuperAdmin(db.identity, actor);
  return db.withSystem('super admin: list payments to review', async ({ db: tx }) => {
    const rows = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.status, filter.status ?? 'REPORTED'))
      .orderBy(asc(schema.payments.reportedAt), asc(schema.payments.createdAt))
      .limit(200);
    const views = await viewsOf(tx, rows);
    const result: ReviewRow[] = [];
    for (const [index, row] of rows.entries()) {
      const company = await companyRow(tx, row.tenantId);
      const [proofs] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.paymentProofs)
        .where(eq(schema.paymentProofs.paymentId, row.id));
      result.push({
        ...views[index]!,
        realTenantId: row.tenantId,
        company: { name: company.name, ruc: company.ruc },
        proofs: proofs!.n,
      });
    }
    return result;
  });
}

export async function paymentForReview(
  actor: PlatformActor,
  db: Database,
  id: string,
): Promise<ReviewRow & { proofList: ProofView[] }> {
  await assertSuperAdmin(db.identity, actor);
  const paymentId = z.uuid().parse(id);
  return db.withSystem('super admin: read a payment', async ({ db: tx }) => {
    const [row] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
    if (!row) throw new DomainError('NOT_FOUND', 'Payment not found');
    const company = await companyRow(tx, row.tenantId);
    // Every file ever sent, the ones the company took out too.
    const proofs = await tx
      .select()
      .from(schema.paymentProofs)
      .where(eq(schema.paymentProofs.paymentId, row.id))
      .orderBy(asc(schema.paymentProofs.createdAt));
    return {
      ...(await viewsOf(tx, [row]))[0]!,
      realTenantId: row.tenantId,
      company: { name: company.name, ruc: company.ruc },
      proofs: proofs.length,
      proofList: proofs.map(proofView),
    };
  });
}

export async function proofFileForReview(
  actor: PlatformActor,
  db: Database,
  input: { paymentId: string; proofId: string },
): Promise<ProofFile> {
  await assertSuperAdmin(db.identity, actor);
  const ids = z.object({ paymentId: z.uuid(), proofId: z.uuid() }).parse(input);
  return db.withSystem('super admin: open a payment proof', ({ db: tx }) =>
    proofFrom(tx, ids.paymentId, ids.proofId, false),
  );
}

const snapshotOf = (term: SubscriptionTerm): Record<string, unknown> => ({ ...term });

// The one place a verified payment becomes access (ADR-029): it records the subscription as it
// was, then moves it. Same transaction as the verification, card or transfer alike.
export async function applyVerifiedPayment(
  tx: Tx['db'],
  payment: PaymentRow,
  now: Date,
): Promise<SubscriptionTerm> {
  const row = await companyRow(tx, payment.tenantId);
  const company: CompanyTenants = {
    realTenantId: row.realTenantId,
    twinTenantId: row.twinTenantId,
  };
  const subscription = await subscriptionOf(tx, company.realTenantId);
  const today = ecuadorDate(now);
  let term: SubscriptionTerm;
  if (payment.purpose === 'INITIAL') {
    // The first cycle is the one period that starts on the day it is paid (lesson 1).
    term = {
      planId: payment.targetPlanId!,
      interval: payment.targetInterval!,
      status: 'ACTIVE',
      periodStart: today,
      periodEnd: periodEndFrom(today, payment.targetInterval!),
    };
  } else if (payment.purpose === 'RENEWAL') {
    if (subscription.periodEnd === null)
      throw new DomainError('NOT_BILLED', 'Only a billed period is renewed');
    // From the old end, never today: a late payment never moves the billing day.
    term = {
      planId: subscription.planId,
      interval: subscription.interval,
      status: 'ACTIVE',
      periodStart: subscription.periodEnd,
      periodEnd: periodEndFrom(subscription.periodEnd, subscription.interval),
    };
  } else {
    // Plan changes, seats and packs arrive in Milestone 8, step 4.
    throw new DomainError('PAYMENT_PURPOSE_UNSUPPORTED', 'This payment can not be applied yet');
  }
  const before = await applySubscriptionTerm(tx, company, term);
  await tx
    .update(schema.payments)
    .set({
      appliedFrom: snapshotOf(before),
      periodStart: term.periodStart,
      periodEnd: term.periodEnd,
    })
    .where(eq(schema.payments.id, payment.id));
  return term;
}

export const reviewPaymentInput = z.discriminatedUnion('decision', [
  z.object({ paymentId: z.uuid(), decision: z.literal('VERIFIED') }),
  z.object({
    paymentId: z.uuid(),
    decision: z.literal('REJECTED'),
    reason: z.enum(PAYMENT_REJECTION_REASONS),
  }),
]);
export type ReviewPaymentInput = z.input<typeof reviewPaymentInput>;

// FR-BILL-3, FR-BILL-4: the operator's one decision on a transfer. Verifying grants access at
// once; the operator's own invoice for it is then owed, in the invoicing queue.
export async function reviewPayment(
  actor: PlatformActor,
  db: Database,
  raw: ReviewPaymentInput,
): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  const input = reviewPaymentInput.parse(raw);
  await db.withSystem('super admin: review a payment', async ({ db: tx }) => {
    const payment = await lockPayment(tx, input.paymentId);
    // Settled once: verifying twice would extend a period twice.
    if (!OPEN.includes(payment.status))
      throw new DomainError('PAYMENT_NOT_REVIEWABLE', 'This payment is already settled', {
        status: payment.status,
      });
    const now = actor.clock.now();
    if (input.decision === 'REJECTED') {
      if (payment.status !== 'REPORTED')
        throw new DomainError('PAYMENT_NOT_REVIEWABLE', 'Only a reported transfer is rejected');
      await tx
        .update(schema.payments)
        .set({ status: 'REJECTED', rejectionReason: input.reason })
        .where(eq(schema.payments.id, payment.id));
    } else {
      await tx
        .update(schema.payments)
        .set({
          status: 'VERIFIED',
          verifiedAt: now,
          verifiedBy: actor.userId,
          rejectionReason: null,
        })
        .where(eq(schema.payments.id, payment.id));
      await applyVerifiedPayment(tx, payment, now);
    }
    await recordAudit(tx, {
      tenantId: payment.tenantId,
      actorUserId: actor.userId,
      action: input.decision === 'VERIFIED' ? 'payment.verified' : 'payment.rejected',
      details: {
        code: payment.code,
        purpose: payment.purpose,
        ...(input.decision === 'REJECTED' ? { reason: input.reason } : {}),
      },
    });
  });
}

export const refundPaymentInput = z.object({
  paymentId: z.uuid(),
  reason: z.string().trim().min(3).max(300),
});
export type RefundPaymentInput = z.input<typeof refundPaymentInput>;

// FR-BILL-8: money came back (a reversed transfer, a duplicate). The subscription returns to the
// state recorded just before the payment changed it, never "down to Gratis" blindly. Whether the
// company is also suspended is a separate decision.
export async function refundPayment(
  actor: PlatformActor,
  db: Database,
  raw: RefundPaymentInput,
): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  const input = refundPaymentInput.parse(raw);
  await db.withSystem('super admin: refund a payment', async ({ db: tx }) => {
    const payment = await lockPayment(tx, input.paymentId);
    if (payment.status !== 'VERIFIED' || !payment.appliedFrom)
      throw new DomainError('PAYMENT_NOT_REFUNDABLE', 'Only a verified payment is refunded', {
        status: payment.status,
      });
    // A later payment built on this one: undo that one first, or the restore would erase it.
    const [later] = await tx
      .select({ code: schema.payments.code })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.tenantId, payment.tenantId),
          eq(schema.payments.status, 'VERIFIED'),
          // uuidv7 ids follow creation, so they settle a tie in time.
          sql`(${schema.payments.verifiedAt}, ${schema.payments.id}) > (${payment.verifiedAt}, ${payment.id})`,
        ),
      )
      .limit(1);
    if (later)
      throw new DomainError('PAYMENT_NOT_REFUNDABLE', 'Refund the later payment first', {
        later: later.code,
      });
    const row = await companyRow(tx, payment.tenantId);
    await applySubscriptionTerm(
      tx,
      { realTenantId: row.realTenantId, twinTenantId: row.twinTenantId },
      payment.appliedFrom as SubscriptionTerm,
    );
    await tx
      .update(schema.payments)
      .set({
        status: 'REFUNDED',
        refundedAt: actor.clock.now(),
        refundedBy: actor.userId,
        refundReason: input.reason,
      })
      .where(eq(schema.payments.id, payment.id));
    await recordAudit(tx, {
      tenantId: payment.tenantId,
      actorUserId: actor.userId,
      action: 'payment.refunded',
      details: { code: payment.code, purpose: payment.purpose, reason: input.reason },
    });
  });
}
