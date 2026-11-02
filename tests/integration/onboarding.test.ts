import { randomUUID } from 'node:crypto';
import { createKeyCipher, fixedClock, onboardOrganization } from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// FR-ONB-2, FR-ONB-3, FR-ONB-4.
describe('onboarding', () => {
  const keyCipher = createKeyCipher('c'.repeat(64));
  const deps = { keyCipher, clock: fixedClock(new Date().toISOString()) };
  let db: Database;
  let owner: string;

  const input = (ruc: string, file: Buffer, password = 'secret') => ({
    ownerUserId: owner,
    ruc,
    legalName: 'Gamma S.A.',
    tradeName: 'Gamma',
    mainAddress: 'Av. 9 de Octubre, Guayaquil',
    requiredAccounting: true,
    branch: { code: '001', name: 'Matriz', address: null },
    issuePointCode: '001',
    certificate: { file, password },
    logo: PNG,
  });
  const tenantsWithRuc = (ruc: string) =>
    db.withSystem('test: count tenants by RUC', ({ db: tx }) =>
      tx.select().from(schema.tenants).where(eq(schema.tenants.ruc, ruc)),
    );

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `o.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    owner = user!.id;
  });

  afterAll(() => db.close());

  it('stores the encrypted key, certificate and logo on the organization and its twin', async () => {
    const ruc = testRuc();
    const created = await onboardOrganization(db, input(ruc, createTestP12({ ruc })), deps);

    const stored = [];
    for (const tenantId of [created.realTenantId, created.twinTenantId]) {
      stored.push(
        await db.withTenant({ tenantId }, async ({ db: tx }) => ({
          tenant: (await tx.select().from(schema.tenants))[0],
          certificates: await tx.select().from(schema.certificates),
          logos: await tx.select().from(schema.tenantLogos),
        })),
      );
    }
    for (const { tenant, certificates, logos } of stored) {
      expect(tenant).toMatchObject({ ruc, requiredAccounting: true, tradeName: 'Gamma' });
      expect(certificates).toHaveLength(1);
      expect(certificates[0]).toMatchObject({
        active: true,
        subjectName: 'ANA PEREZ',
        issuerName: 'TEST CA S.A.',
      });
      // Never stored in clear, and decrypts back to the key.
      expect(certificates[0]!.encryptedPrivateKey).not.toContain('PRIVATE KEY');
      expect(keyCipher.decrypt(certificates[0]!.encryptedPrivateKey)).toMatch(
        /^-----BEGIN RSA PRIVATE KEY-----/,
      );
      expect(logos[0]).toMatchObject({ contentType: 'image/png' });
      expect(Buffer.from(logos[0]!.content).equals(PNG)).toBe(true);
    }
    expect(stored[0]!.certificates[0]!.fingerprint).toBe(stored[1]!.certificates[0]!.fingerprint);
  });

  it.each([
    [
      'a certificate for another RUC',
      () => input(testRuc(), createTestP12({ ruc: testRuc() })),
      'CERTIFICATE_RUC_MISMATCH',
    ],
    ['a malformed RUC', () => input('9912345678001', createTestP12()), 'INVALID_RUC'],
    [
      'a wrong certificate password',
      () => {
        const ruc = testRuc();
        return input(ruc, createTestP12({ ruc }), 'wrong');
      },
      'CERTIFICATE_PASSWORD_INVALID',
    ],
  ])('refuses %s and creates nothing', async (_, build, code) => {
    const attempt = build();
    await expect(onboardOrganization(db, attempt, deps)).rejects.toMatchObject({ code });
    await expect(tenantsWithRuc(attempt.ruc)).resolves.toHaveLength(0);
  });

  it('keeps one active certificate per tenant', async () => {
    const ruc = testRuc();
    const { realTenantId } = await onboardOrganization(
      db,
      input(ruc, createTestP12({ ruc })),
      deps,
    );
    await expect(
      db.withTenant({ tenantId: realTenantId }, async ({ db: tx }) => {
        const [current] = await tx.select().from(schema.certificates);
        await tx.insert(schema.certificates).values({
          tenantId: realTenantId,
          encryptedPrivateKey: current!.encryptedPrivateKey,
          certificatePem: current!.certificatePem,
          fingerprint: 'f'.repeat(64),
          subjectName: current!.subjectName,
          issuerName: current!.issuerName,
          notBefore: current!.notBefore,
          notAfter: current!.notAfter,
        });
      }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });
});
