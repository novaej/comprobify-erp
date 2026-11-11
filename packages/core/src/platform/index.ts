import type { Database, SuspensionReason, Tx } from '@comprobify/db';
import { z } from 'zod';
import { recordAudit, type AuditEvent } from '../audit';
import {
  applyAddModule,
  applyBilling,
  applyClearLimit,
  applyClearOverride,
  applyComplimentary,
  applyLimit,
  applyNegotiatedPrice,
  applyOverride,
  applyPlanChange,
  applyRemoveModule,
  catalogChoices,
  companyPlanDetail,
  subscriptionState,
  subscriptionSummaries,
  type CatalogChoices,
  type CompanyPlanDetail,
  type CompanyTenants,
  type SubscriptionSummary,
} from '../entitlements';
import { repriceAndTell } from '../billing';
import type { NotifyDeps } from '../notifications';
import { assertSuperAdmin } from '../identity';
import { startOfEcuadorDay, type PlatformActor } from '../kernel';
import {
  applyReactivation,
  applySuspension,
  companyRow,
  listCompanyRows,
  type CompanyRow,
} from '../tenancy';

export * from './activity';
export * from './billing';
export * from './catalog';
export * from './email-templates';
export * from './jobs';

// The super admin area (ADR-010, FR-ADM-1): platform work outside any tenant. Each
// function owns its system-context transaction and records the change in the company's
// activity log, written in the real company like every change to a company and its twin.

const tenantId = z.uuid();

export type CompanyListEntry = CompanyRow & { subscription: SubscriptionSummary };

export async function listCompanies(
  actor: PlatformActor,
  db: Database,
  options: { query?: string } = {},
): Promise<CompanyListEntry[]> {
  await assertSuperAdmin(db.identity, actor);
  return db.withSystem('super admin: list companies', async ({ db: tx }) => {
    const rows = await listCompanyRows(tx, { query: options.query?.slice(0, 100) });
    const summaries = await subscriptionSummaries(
      tx,
      rows.map((row) => row.realTenantId),
    );
    return rows.map((row) => ({ ...row, subscription: summaries.get(row.realTenantId)! }));
  });
}

export type CompanyAdminView = {
  company: CompanyRow;
  plan: CompanyPlanDetail;
  choices: CatalogChoices;
};

export async function getCompany(
  actor: PlatformActor,
  db: Database,
  realTenantId: string,
): Promise<CompanyAdminView> {
  await assertSuperAdmin(db.identity, actor);
  const id = tenantId.parse(realTenantId);
  return db.withSystem('super admin: view a company', async ({ db: tx }) => {
    const company = await companyRow(tx, id);
    return {
      company,
      plan: await companyPlanDetail(tx, company, actor.clock.now()),
      choices: await catalogChoices(tx),
    };
  });
}

type Change = Pick<AuditEvent, 'action' | 'details'>;

async function change(
  actor: PlatformActor,
  db: Database,
  realTenantId: string,
  reason: string,
  fn: (tx: Tx['db'], company: CompanyTenants, txAll: Tx) => Promise<Change>,
): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  const id = tenantId.parse(realTenantId);
  await db.withSystem(reason, async (txAll) => {
    const tx = txAll.db;
    const row = await companyRow(tx, id);
    const event = await fn(
      tx,
      { realTenantId: row.realTenantId, twinTenantId: row.twinTenantId },
      txAll,
    );
    await recordAudit(tx, { tenantId: row.realTenantId, actorUserId: actor.userId, ...event });
  });
}

export const changePlan = (
  actor: PlatformActor,
  db: Database,
  input: { realTenantId: string; planKey: string },
) =>
  change(actor, db, input.realTenantId, 'super admin: change a company plan', async (tx, c) => {
    const result = await applyPlanChange(tx, c, input);
    return {
      action: 'subscription.plan_changed',
      details: { from: result.from, to: result.to, planEs: result.nameEs, planEn: result.nameEn },
    };
  });

export const setBilling = (
  actor: PlatformActor,
  db: Database,
  input: { realTenantId: string } & (
    { complimentary: true; reason: string } | { complimentary: false }
  ),
) =>
  change(
    actor,
    db,
    input.realTenantId,
    'super admin: set how a company is billed',
    async (tx, c) => {
      await applyBilling(tx, c, input);
      return {
        action: 'subscription.billing_changed',
        details: {
          billing: input.complimentary ? 'COMPLIMENTARY' : 'PAID',
          reason: input.complimentary ? input.reason.trim() : null,
        },
      };
    },
  );

export const setNegotiatedPrice = (
  actor: PlatformActor,
  db: Database,
  input: { realTenantId: string; monthlyPrice: string | null },
  // ADR-035: a renewal not paid yet is priced again at the new price, and the payer told.
  notice: NotifyDeps,
) =>
  change(
    actor,
    db,
    input.realTenantId,
    'super admin: set a negotiated price',
    async (tx, c, txAll) => {
      await applyNegotiatedPrice(tx, c, input);
      await repriceAndTell(txAll, c.realTenantId, actor.clock.now(), notice);
      return {
        action: 'subscription.price_changed',
        details: { monthlyPrice: input.monthlyPrice },
      };
    },
  );

export const addModule = (
  actor: PlatformActor,
  db: Database,
  input: { realTenantId: string; moduleKey: string; complimentaryReason?: string | null },
) =>
  change(actor, db, input.realTenantId, 'super admin: add a module to a company', async (tx, c) => {
    const module = await applyAddModule(tx, c, input);
    return {
      action: 'subscription.module_added',
      details: {
        module: input.moduleKey,
        moduleEs: module.nameEs,
        moduleEn: module.nameEn,
        complimentary: input.complimentaryReason ?? null,
      },
    };
  });

// ADR-035: an add-on given without charge (a reason), or charged again (null).
export const setAddOnComplimentary = (
  actor: PlatformActor,
  db: Database,
  input: { realTenantId: string; moduleKey: string; reason: string | null },
) =>
  change(actor, db, input.realTenantId, 'super admin: give or charge an add-on', async (tx, c) => {
    const module = await applyComplimentary(tx, c, input);
    return {
      action: 'subscription.module_complimentary',
      details: {
        module: input.moduleKey,
        moduleEs: module.nameEs,
        moduleEn: module.nameEn,
        reason: input.reason,
      },
    };
  });

// The company keeps it until its next period starts: the end of its quota window (ADR-011,
// ADR-028).
export const removeModule = (
  actor: PlatformActor,
  db: Database,
  input: { realTenantId: string; moduleKey: string },
) =>
  change(actor, db, input.realTenantId, 'super admin: remove a module', async (tx, c) => {
    const { window } = await subscriptionState(tx, c.realTenantId, actor.clock.now());
    const removesAt = startOfEcuadorDay(window.end);
    const module = await applyRemoveModule(tx, c, input, removesAt);
    return {
      action: 'subscription.module_removed',
      details: {
        module: input.moduleKey,
        moduleEs: module.nameEs,
        moduleEn: module.nameEn,
        removesAt: removesAt.toISOString(),
      },
    };
  });

export const setLimit = (
  actor: PlatformActor,
  db: Database,
  input: { realTenantId: string; featureKey: string; value: number | null },
) =>
  change(actor, db, input.realTenantId, 'super admin: set a Personalizado limit', async (tx, c) => {
    await applyLimit(tx, c, input);
    return {
      action: 'subscription.limit_set',
      details: { feature: input.featureKey, value: input.value },
    };
  });

export const clearLimit = (
  actor: PlatformActor,
  db: Database,
  input: { realTenantId: string; featureKey: string },
) =>
  change(
    actor,
    db,
    input.realTenantId,
    'super admin: clear a Personalizado limit',
    async (tx, c) => {
      await applyClearLimit(tx, c, input);
      return { action: 'subscription.limit_cleared', details: { feature: input.featureKey } };
    },
  );

export const setOverride = (
  actor: PlatformActor,
  db: Database,
  input: {
    realTenantId: string;
    featureKey: string;
    effect: 'GRANT' | 'REVOKE' | 'LIMIT';
    limitValue: number | null;
    reason: string;
  },
) =>
  change(actor, db, input.realTenantId, 'super admin: set a feature override', async (tx, c) => {
    await applyOverride(tx, c, input, actor.userId);
    return {
      action: 'entitlements.override_set',
      details: {
        feature: input.featureKey,
        effect: input.effect,
        value: input.limitValue,
        reason: input.reason.trim(),
      },
    };
  });

export const clearOverride = (
  actor: PlatformActor,
  db: Database,
  input: { realTenantId: string; featureKey: string },
) =>
  change(actor, db, input.realTenantId, 'super admin: clear a feature override', async (tx, c) => {
    await applyClearOverride(tx, c, input);
    return { action: 'entitlements.override_cleared', details: { feature: input.featureKey } };
  });

// FR-BILL-9: the company keeps reading its data and can do nothing else until reactivated.
export const suspendCompany = (
  actor: PlatformActor,
  db: Database,
  input: { realTenantId: string; reason: SuspensionReason; note?: string | null },
) =>
  change(actor, db, input.realTenantId, 'super admin: suspend a company', async (tx, c) => {
    const applied = await applySuspension(
      tx,
      c,
      { reason: input.reason, note: input.note ?? null },
      actor.clock.now(),
    );
    return {
      action: 'organization.suspended',
      details: { reason: applied.reason, note: applied.note },
    };
  });

export const reactivateCompany = (
  actor: PlatformActor,
  db: Database,
  input: { realTenantId: string },
) =>
  change(actor, db, input.realTenantId, 'super admin: reactivate a company', async (tx, c) => {
    await applyReactivation(tx, c);
    return { action: 'organization.reactivated', details: {} };
  });
