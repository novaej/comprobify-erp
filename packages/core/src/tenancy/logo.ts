import { eq, schema, type Database, type Tx } from '@comprobify/db';
import { recordAudit } from '../audit';
import { DomainError, hasFeature, requirePermission, type ActorContext } from '../kernel';
import { pairOf } from './pair';

export const LOGO_MAX_BYTES = 500 * 1024;

export type Logo = { content: Buffer; contentType: 'image/png' | 'image/jpeg' | 'image/gif' };

// By content, not by the file name or the browser's claim (PRD 9.3).
export function sniffLogo(content: Buffer): Logo {
  if (content.length === 0 || content.length > LOGO_MAX_BYTES) {
    throw new DomainError('INVALID_LOGO', 'The logo must be at most 500 KB');
  }
  const starts = (bytes: number[]) => bytes.every((byte, index) => content[index] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { content, contentType: 'image/png' };
  if (starts([0xff, 0xd8, 0xff])) return { content, contentType: 'image/jpeg' };
  const head = content.subarray(0, 6).toString('ascii');
  if (head === 'GIF87a' || head === 'GIF89a') return { content, contentType: 'image/gif' };
  throw new DomainError('INVALID_LOGO', 'The logo must be a PNG, JPEG or GIF image');
}

// The logo printed on documents. Onboarding stores it on any plan; it is used only
// while the company has RIDE_LOGO (the Marca module), so upgrading brings it back.
export async function companyLogo(ctx: ActorContext, db: Database): Promise<Logo | null> {
  if (!hasFeature(ctx, 'RIDE_LOGO')) return null;
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const [row] = await tx
      .select({ content: schema.tenantLogos.content, contentType: schema.tenantLogos.contentType })
      .from(schema.tenantLogos)
      .where(eq(schema.tenantLogos.tenantId, ctx.tenantId));
    return row
      ? { content: row.content, contentType: row.contentType as Logo['contentType'] }
      : null;
  });
}

// The worker's read, by tenant: the logo for a RIDE while the plan has RIDE_LOGO.
export async function documentLogo(
  tx: Tx,
  tenantId: string,
  features: readonly string[],
): Promise<Buffer | null> {
  if (!features.includes('RIDE_LOGO')) return null;
  const [row] = await tx.db
    .select({ content: schema.tenantLogos.content })
    .from(schema.tenantLogos)
    .where(eq(schema.tenantLogos.tenantId, tenantId));
  return row?.content ?? null;
}

// Replaces the logo of the company and its twin together, on any plan: it prints on documents
// only while the plan has RIDE_LOGO, so a company can set it before buying Marca.
export async function setCompanyLogo(
  ctx: ActorContext,
  db: Database,
  file: Uint8Array,
): Promise<void> {
  requirePermission(ctx, 'organization.manage');
  const logo = sniffLogo(Buffer.from(file));
  await db.withSystem('replace the logo of a company and its twin', async ({ db: tx }) => {
    const pair = await pairOf(tx, ctx.tenantId);
    for (const tenantId of [pair.realTenantId, pair.twinTenantId]) {
      if (!tenantId) continue;
      await tx
        .insert(schema.tenantLogos)
        .values({ tenantId, ...logo })
        .onConflictDoUpdate({
          target: schema.tenantLogos.tenantId,
          set: { content: logo.content, contentType: logo.contentType },
        });
    }
    await recordAudit(tx, {
      tenantId: pair.realTenantId,
      actorUserId: ctx.userId ?? null,
      action: 'organization.settings_changed',
      details: { logo: true },
    });
  });
}
