import { randomUUID } from 'node:crypto';
import {
  createKeyCipher,
  fixedClock,
  onboardOrganization,
  rotateCertificateKeys,
  type CreatedOrganization,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { inArray, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase } from './helpers';

// ADR-052, PRD 9.3: CERT_ENCRYPTION_KEY changes with no moment where a certificate can't be read.
describe('certificate key rotation', () => {
  const clock = fixedClock(new Date().toISOString());
  const oldKey = 'f1'.repeat(32);
  const newKey = 'f2'.repeat(32);
  let db: Database;
  let org: CreatedOrganization;
  let tenantIds: string[];

  const stored = async () =>
    db.withSystem('test: read stored certificate keys', ({ db: tx }) =>
      tx
        .select({ value: schema.certificates.encryptedPrivateKey })
        .from(schema.certificates)
        .where(inArray(schema.certificates.tenantId, tenantIds)),
    );

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `rot.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: user!.id,
        ruc,
        legalName: 'Rotación S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2026-01-01'),
            notAfter: new Date('2028-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher: createKeyCipher(oldKey), clock },
    );
    tenantIds = [org.realTenantId, org.twinTenantId];
  });
  afterAll(() => db.close());

  it('re-encrypts every stored key under the new one, after a dry run, and only once', async () => {
    const rotating = createKeyCipher(newKey, oldKey);
    const before = await stored();
    expect(before).toHaveLength(2);

    // A dry run opens every value and writes nothing.
    await expect(
      rotateCertificateKeys(db, rotating, { commit: false, tenantIds }),
    ).resolves.toMatchObject({ total: 2, reencrypted: 2 });
    expect(await stored()).toEqual(before);

    const report = await rotateCertificateKeys(db, rotating, { commit: true, tenantIds });
    expect(report).toEqual({
      total: 2,
      reencrypted: 2,
      byKey: { [createKeyCipher(oldKey).currentKeyId]: 2 },
    });
    // The new key alone now reads them, in the company and its test copy.
    const onlyNew = createKeyCipher(newKey);
    for (const { value } of await stored()) {
      expect(onlyNew.isCurrent(value)).toBe(true);
      expect(onlyNew.decrypt(value)).toContain('PRIVATE KEY');
    }
    await expect(
      rotateCertificateKeys(db, rotating, { commit: true, tenantIds }),
    ).resolves.toMatchObject({ reencrypted: 0 });
  });

  it('changes nothing when a value opens with no configured key', async () => {
    const before = await stored();
    await expect(
      rotateCertificateKeys(db, createKeyCipher('f3'.repeat(32)), { commit: true, tenantIds }),
    ).rejects.toThrow(/not configured/);
    expect(await stored()).toEqual(before);
  });
});
