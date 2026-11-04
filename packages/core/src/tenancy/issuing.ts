import { and, eq, schema, type TAX_REGIMES, type Tx } from '@comprobify/db';
import { DomainError, type ActorContext } from '../kernel';

export type IssuingContext = {
  ruc: string;
  legalName: string;
  tradeName: string | null;
  mainAddress: string;
  requiredAccounting: boolean;
  specialTaxpayerResolution: string | null;
  withholdingAgentResolution: string | null;
  taxRegime: (typeof TAX_REGIMES)[number];
  branchCode: string;
  branchAddress: string;
  pointCode: string;
  certificate: { encryptedPrivateKey: string; certificatePem: string };
};

// What a document needs from its company, read inside the creating transaction (FR-DOC-2
// step 2): the company must be live, the issue point active, not paused and allowed to the actor (FR-ROLE-2),
// and the company must have an active certificate.
export async function issuingContext(
  ctx: ActorContext,
  tx: Tx,
  issuePointId: string,
): Promise<IssuingContext> {
  const { tenants, branches, issuePoints, certificates } = schema;
  if (ctx.issuePointIds !== null && !ctx.issuePointIds.includes(issuePointId))
    throw new DomainError('ISSUE_POINT_NOT_ALLOWED', 'This issue point is not assigned to you');
  const [row] = await tx.db
    .select({
      ruc: tenants.ruc,
      legalName: tenants.legalName,
      tradeName: tenants.tradeName,
      mainAddress: tenants.mainAddress,
      requiredAccounting: tenants.requiredAccounting,
      specialTaxpayerResolution: tenants.specialTaxpayerResolution,
      withholdingAgentResolution: tenants.withholdingAgentResolution,
      taxRegime: tenants.taxRegime,
      mode: tenants.mode,
      liveAt: tenants.liveAt,
      branchCode: branches.code,
      branchAddress: branches.address,
      branchActive: branches.active,
      pointCode: issuePoints.code,
      pointActive: issuePoints.active,
      canIssue: issuePoints.canIssue,
    })
    .from(issuePoints)
    .innerJoin(branches, eq(branches.id, issuePoints.branchId))
    .innerJoin(tenants, eq(tenants.id, issuePoints.tenantId))
    .where(and(eq(issuePoints.id, issuePointId), eq(issuePoints.tenantId, ctx.tenantId)));
  if (!row || !row.pointActive || !row.branchActive)
    throw new DomainError('NOT_FOUND', 'Issue point not found');
  // FR-ONB-5: going live is what enables issuing in the real company; the twin always can.
  if (row.mode === 'PRODUCTION' && row.liveAt === null)
    throw new DomainError('NOT_LIVE', 'The company has not gone live yet');
  if (!row.canIssue) throw new DomainError('ISSUE_POINT_PAUSED', 'This issue point is paused');

  const [certificate] = await tx.db
    .select({
      encryptedPrivateKey: certificates.encryptedPrivateKey,
      certificatePem: certificates.certificatePem,
    })
    .from(certificates)
    .where(and(eq(certificates.tenantId, ctx.tenantId), eq(certificates.active, true)));
  if (!certificate)
    throw new DomainError('CERTIFICATE_MISSING', 'The company has no signing certificate');

  return {
    ruc: row.ruc,
    legalName: row.legalName,
    tradeName: row.tradeName,
    mainAddress: row.mainAddress,
    requiredAccounting: row.requiredAccounting,
    specialTaxpayerResolution: row.specialTaxpayerResolution,
    withholdingAgentResolution: row.withholdingAgentResolution,
    taxRegime: row.taxRegime,
    branchCode: row.branchCode,
    branchAddress: row.branchAddress,
    pointCode: row.pointCode,
    certificate,
  };
}
