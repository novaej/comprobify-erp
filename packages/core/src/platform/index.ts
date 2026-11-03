import type { Database, Tx } from '@comprobify/db';
import { z } from 'zod';
import { recordAudit, type AuditEvent } from '../audit';
import {
  applyAddModule,
  applyBilling,
  applyClearLimit,
  applyClearOverride,
  applyLimit,
  applyNegotiatedPrice,
  applyOverride,
  applyPlanChange,
  applyRemoveModule,
  catalogChoices,
  companyPlanDetail,
  subscriptionSummaries,
  type CatalogChoices,
  type CompanyPlanDetail,
  type CompanyTenants,
  type SubscriptionSummary,
} from '../entitlements';
import { assertSuperAdmin } from '../identity';
import { startOfNextEcuadorMonth, type PlatformActor } from '../kernel';
import { companyRow, listCompanyRows, type CompanyRow } from '../tenancy';

export * from './catalog';

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
  fn: (tx: Tx['db'], company: CompanyTenants) => Promise<Change>,
): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  const id = tenantId.parse(realTenantId);
  await db.withSystem(reason, async ({ db: tx }) => {
    const row = await companyRow(tx, id);
    const event = await fn(tx, { realTenantId: row.realTenantId, twinTenantId: row.twinTenantId });
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
) =>
  change(actor, db, input.realTenantId, 'super admin: set a negotiated price', async (tx, c) => {
    await applyNegotiatedPrice(tx, c, input);
    return { action: 'subscription.price_changed', details: { monthlyPrice: input.monthlyPrice } };
  });

export const addModule = (
  actor: PlatformActor,
  db: Database,
  input: { realTenantId: string; moduleKey: string },
) =>
  change(actor, db, input.realTenantId, 'super admin: add a module to a company', async (tx, c) => {
    const module = await applyAddModule(tx, c, input);
    return {
      action: 'subscription.module_added',
      details: { module: input.moduleKey, moduleEs: module.nameEs, moduleEn: module.nameEn },
    };
  });

// The company keeps it until the next period starts (ADR-011).
export const removeModule = (
  actor: PlatformActor,
  db: Database,
  input: { realTenantId: string; moduleKey: string },
) =>
  change(actor, db, input.realTenantId, 'super admin: remove a module', async (tx, c) => {
    const removesAt = startOfNextEcuadorMonth(actor.clock.now());
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
