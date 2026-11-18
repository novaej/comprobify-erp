import { createDecipheriv } from 'node:crypto';
import { z } from 'zod';

// ADR-049: what the operator's script reads from a restored copy of the previous system's two
// databases (the API's and the web app's), for one company. Plain data: core never connects
// to the old databases.

const bytes = z.custom<Uint8Array>((value) => value instanceof Uint8Array, 'Expected bytes');
const nullableText = z.string().nullable();

export const legacyExportInput = z.object({
  company: z.object({
    ruc: z.string().regex(/^[0-9]{13}$/),
    legalName: z.string(),
    tradeName: nullableText,
    mainAddress: z.string(),
    // 'SI' or 'NO', as the XML prints it.
    requiredAccounting: nullableText,
    specialTaxpayer: nullableText,
    withholdingAgent: nullableText,
    rimpe: nullableText,
    contactEmail: nullableText,
    idleTimeoutMinutes: z.number().int().nullable(),
  }),
  // The previous system's issuer: one branch and issue point of the company.
  issuers: z.array(
    z.object({
      branchCode: z.string(),
      issuePointCode: z.string(),
      branchAddress: z.string(),
      canIssue: z.boolean(),
      active: z.boolean(),
      documentTypes: z.array(z.string()),
      // Encrypted with the previous system's ENCRYPTION_KEY.
      encryptedPrivateKey: nullableText,
      certificatePem: nullableText,
      certificateFingerprint: nullableText,
      logo: bytes.nullable(),
    }),
  ),
  sequentials: z.array(
    z.object({
      branchCode: z.string(),
      issuePointCode: z.string(),
      documentType: z.string(),
      currentValue: z.number().int(),
    }),
  ),
  documents: z.array(
    z.object({
      documentType: z.string(),
      accessKey: z.string(),
      sequential: z.number().int(),
      branchCode: z.string(),
      issuePointCode: z.string(),
      status: z.string(),
      signedXml: nullableText,
      authorizationXml: nullableText,
      authorizationNumber: nullableText,
      authorizationDate: z.date().nullable(),
      buyerEmail: nullableText,
      voidReason: nullableText,
      voidedAt: z.date().nullable(),
      createdAt: z.date(),
      events: z.array(
        z.object({
          eventType: z.string(),
          fromStatus: nullableText,
          toStatus: nullableText,
          detail: z.record(z.string(), z.unknown()).nullable(),
          createdAt: z.date(),
        }),
      ),
      sriResponses: z.array(
        z.object({
          operationType: z.string(),
          status: nullableText,
          messages: z.unknown(),
          rawResponse: nullableText,
          createdAt: z.date(),
        }),
      ),
    }),
  ),
  // The web app's accounts: the company's members and those who never made a company.
  users: z.array(
    z.object({
      email: z.string(),
      firstName: nullableText,
      lastName: nullableText,
      passwordHash: nullableText,
      // The company role ('Owner', ...), null for an account with no company.
      role: nullableText,
      createdAt: z.date(),
    }),
  ),
  clients: z.array(
    z.object({
      idType: z.string(),
      identification: z.string(),
      name: z.string(),
      email: nullableText,
      address: nullableText,
    }),
  ),
  products: z.array(
    z.object({
      code: z.string(),
      auxiliaryCode: nullableText,
      name: z.string(),
      unitPrice: z.string(),
      // '<tax code>-<rate code>', '2-4' for IVA 15 %.
      taxOption: z.string(),
    }),
  ),
  templates: z.array(z.object({ name: z.string(), documentType: z.string(), data: z.unknown() })),
});
export type LegacyExport = z.input<typeof legacyExportInput>;

// The previous system's format: AES-256-GCM, '<iv>:<tag>:<ciphertext>' in hex, a 16-byte IV.
export function decryptLegacyValue(stored: string, keyHex: string): string {
  if (!/^[0-9a-f]{64}$/i.test(keyHex))
    throw new Error('The previous ENCRYPTION_KEY must be 64 hex characters');
  const [iv, tag, body] = stored.split(':');
  if (!iv || !tag || !body) throw new Error('Not a value the previous system encrypted');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyHex, 'hex'),
    Buffer.from(iv, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'hex')), decipher.final()]).toString(
    'utf8',
  );
}
