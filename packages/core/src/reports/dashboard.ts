import type { Database, DocumentStatus } from '@comprobify/db';
import { quotaUsage, salesFigure, statusCounts, topProducts } from '../documents';
import type { QuotaUsage, SalesFigure, TopProduct } from '../documents';
import { lowStock, type LowStock } from '../inventory';
import {
  ecuadorDate,
  hasFeature,
  requireFeature,
  requirePermission,
  type ActorContext,
} from '../kernel';
import { certificateStatus, type CertificateStatus, type Permission } from '../tenancy';

// FR-REP-1: the figures on the dashboard. Each part is null when the actor's role or the plan
// doesn't reach what it shows, so the page draws only what the person may see.
export type Dashboard = {
  today: string;
  monthStart: string;
  sales: { today: SalesFigure; month: SalesFigure } | null;
  documents: Record<DocumentStatus, number> | null;
  topProducts: TopProduct[] | null;
  lowStock: LowStock[] | null;
  quota: QuotaUsage | null;
  certificate: CertificateStatus;
};

export async function dashboard(ctx: ActorContext, db: Database): Promise<Dashboard> {
  requirePermission(ctx, 'reports.read');
  requireFeature(ctx, 'REPORTS_BASIC');
  const today = ecuadorDate(ctx.clock.now());
  const monthStart = `${today.slice(0, 7)}-01`;
  const sees = (permission: Permission) => ctx.permissions.includes(permission);
  const documents = sees('documents.read');
  const stock = sees('inventory.read') && hasFeature(ctx, 'INVENTORY');

  const [figures, quota, certificate] = await Promise.all([
    db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => ({
      sales: documents
        ? {
            today: await salesFigure(tx, ctx.tenantId, today, today),
            month: await salesFigure(tx, ctx.tenantId, monthStart, today),
          }
        : null,
      documents: documents ? await statusCounts(tx, ctx.tenantId, monthStart) : null,
      topProducts: documents ? await topProducts(tx, ctx.tenantId, monthStart) : null,
      lowStock: stock ? await lowStock(tx, ctx.tenantId) : null,
    })),
    sees('billing.read') ? quotaUsage(ctx, db) : Promise.resolve(null),
    certificateStatus(db, ctx),
  ]);
  return { today, monthStart, ...figures, quota, certificate };
}
