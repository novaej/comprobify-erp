import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import {
  accessKey,
  agingReport,
  createAuth,
  createIdentity,
  createKeyCipher,
  createRateLimiter,
  fixedClock,
  importLegacyCompany,
  parseP12,
  quotaUsage,
  randomNumericCode,
  reconcileLegacyImport,
  resolveActor,
  rideData,
  type LegacyExport,
  type LegacyImportOptions,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { and, eq, inOneTransaction, schema, type Database } from '@comprobify/db';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, testLogger } from './helpers';

// ADR-049, PRD section 15 (Milestone 10): a company from the previous system, imported whole or
// not at all, reconciled, and usable: numbering continues, old passwords sign in.
describe('legacy import', () => {
  const clock = fixedClock(new Date().toISOString());
  const legacyKey = randomBytes(32).toString('hex');
  const password = 'old system password';
  let db: Database;

  // The previous system's format: '<iv>:<tag>:<ciphertext>' in hex, a 16-byte IV.
  const legacyEncrypt = (plaintext: string) => {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(legacyKey, 'hex'), iv);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map((part) => part.toString('hex')).join(':');
  };

  const factura = (ruc: string, sequential: number, issueDate: string) => {
    const key = accessKey({
      issueDate,
      documentType: '01',
      ruc,
      ambiente: '2',
      series: '001001',
      sequential,
      numericCode: randomNumericCode(),
    });
    const [year, month, day] = issueDate.split('-');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="2.1.0"><infoTributaria><ambiente>2</ambiente><tipoEmision>1</tipoEmision><razonSocial>MIGRADA S.A.</razonSocial><ruc>${ruc}</ruc><claveAcceso>${key}</claveAcceso><codDoc>01</codDoc><estab>001</estab><ptoEmi>001</ptoEmi><secuencial>${String(sequential).padStart(9, '0')}</secuencial><dirMatriz>Quito</dirMatriz></infoTributaria><infoFactura><fechaEmision>${day}/${month}/${year}</fechaEmision><obligadoContabilidad>NO</obligadoContabilidad><tipoIdentificacionComprador>08</tipoIdentificacionComprador><razonSocialComprador>Cliente del Exterior LLC</razonSocialComprador><identificacionComprador>30-71144848-5</identificacionComprador><direccionComprador>Miami</direccionComprador><totalSinImpuestos>100.00</totalSinImpuestos><totalDescuento>0.00</totalDescuento><totalConImpuestos><totalImpuesto><codigo>2</codigo><codigoPorcentaje>0</codigoPorcentaje><baseImponible>100.00</baseImponible><valor>0.00</valor></totalImpuesto></totalConImpuestos><propina>0.00</propina><importeTotal>100.00</importeTotal><moneda>DOLAR</moneda><pagos><pago><formaPago>20</formaPago><total>100.00</total></pago></pagos></infoFactura><detalles><detalle><codigoPrincipal>0001</codigoPrincipal><codigoAuxiliar>0001</codigoAuxiliar><descripcion>Servicios profesionales</descripcion><cantidad>1.000000</cantidad><precioUnitario>100.000000</precioUnitario><descuento>0.00</descuento><precioTotalSinImpuesto>100.00</precioTotalSinImpuesto><impuestos><impuesto><codigo>2</codigo><codigoPorcentaje>0</codigoPorcentaje><tarifa>0</tarifa><baseImponible>100.00</baseImponible><valor>0.00</valor></impuesto></impuestos></detalle></detalles><infoAdicional><campoAdicional nombre="Email">cliente@example.com</campoAdicional></infoAdicional></factura>`;
    return { key, xml };
  };

  const exportOf = (ruc: string, emails: { owner: string; other: string; dropped: string }) => {
    const p12 = parseP12(
      createTestP12({ ruc, notBefore: new Date('2026-01-01'), notAfter: new Date('2028-12-31') }),
      'secret',
      clock.now(),
    );
    const hash = bcrypt.hashSync(password, 4);
    const documents = [
      { sequential: 35, date: '2026-10-02' },
      { sequential: 36, date: '2026-11-02' },
    ].map(({ sequential, date }) => {
      const { key, xml } = factura(ruc, sequential, date);
      const at = new Date(`${date}T20:00:00Z`);
      return {
        documentType: '01',
        accessKey: key,
        sequential,
        branchCode: '001',
        issuePointCode: '001',
        status: 'AUTHORIZED',
        signedXml: xml,
        // The second kept only its signed XML, as some of the previous system's rows did.
        authorizationXml: sequential === 35 ? xml : null,
        authorizationNumber: key,
        authorizationDate: at,
        buyerEmail: 'cliente@example.com',
        voidReason: null,
        voidedAt: null,
        createdAt: at,
        events: [
          {
            eventType: 'CREATED',
            fromStatus: null,
            toStatus: 'SIGNED',
            detail: { sequential },
            createdAt: at,
          },
          {
            eventType: 'SENT',
            fromStatus: 'PENDING_SEND',
            toStatus: 'RECEIVED',
            detail: {},
            createdAt: at,
          },
          {
            eventType: 'STATUS_CHANGED',
            fromStatus: 'RECEIVED',
            toStatus: 'AUTHORIZED',
            detail: {},
            createdAt: at,
          },
          {
            eventType: 'EMAIL_SENT',
            fromStatus: null,
            toStatus: null,
            detail: { to: 'cliente@example.com' },
            createdAt: at,
          },
          {
            eventType: 'EMAIL_DELIVERED',
            fromStatus: null,
            toStatus: null,
            detail: {},
            createdAt: at,
          },
        ],
        sriResponses: [
          {
            operationType: 'RECEPTION',
            status: 'RECIBIDA',
            messages: [],
            rawResponse: '<r/>',
            createdAt: at,
          },
          {
            operationType: 'AUTHORIZATION',
            status: 'AUTORIZADO',
            messages: [],
            rawResponse: '<a/>',
            createdAt: at,
          },
        ],
      };
    });
    return {
      company: {
        ruc,
        legalName: 'MIGRADA S.A.',
        tradeName: 'Migrada',
        mainAddress: 'Quito',
        requiredAccounting: 'NO',
        specialTaxpayer: null,
        withholdingAgent: null,
        rimpe: null,
        contactEmail: null,
        idleTimeoutMinutes: 60,
      },
      issuers: [
        {
          branchCode: '001',
          issuePointCode: '001',
          branchAddress: 'Quito',
          canIssue: true,
          active: true,
          documentTypes: ['01'],
          encryptedPrivateKey: legacyEncrypt(p12.privateKeyPem),
          certificatePem: p12.certificatePem,
          certificateFingerprint: p12.fingerprint,
          logo: null,
        },
      ],
      sequentials: [
        { branchCode: '001', issuePointCode: '001', documentType: '01', currentValue: 36 },
      ],
      documents,
      users: [
        {
          email: emails.owner,
          firstName: 'Ana',
          lastName: 'Dueña',
          passwordHash: hash,
          role: 'Owner',
          createdAt: new Date('2026-09-15'),
        },
        {
          email: emails.other,
          firstName: null,
          lastName: null,
          passwordHash: hash,
          role: null,
          createdAt: new Date('2026-11-09'),
        },
        {
          email: emails.dropped,
          firstName: null,
          lastName: null,
          passwordHash: hash,
          role: null,
          createdAt: new Date('2026-09-15'),
        },
      ],
      clients: [
        {
          idType: '08',
          identification: '99-0381648',
          name: 'Cliente Guardado LLC',
          email: 'guardado@example.com',
          address: null,
        },
      ],
      products: [
        {
          code: '0001',
          auxiliaryCode: '0001',
          name: 'Servicios profesionales',
          unitPrice: '100.000000',
          taxOption: '2-0',
        },
      ],
      templates: [
        {
          name: 'Mensual',
          documentType: '01',
          data: {
            buyer: { id: '30-71144848-5', idType: '08' },
            items: [
              {
                mainCode: '0001',
                auxCode: '0001',
                description: 'Servicios profesionales',
                quantity: '1',
                unitPrice: '100.00',
                discount: '0.00',
                taxOption: '2-0',
              },
            ],
            payments: [{ total: '100.00', method: '20' }],
            additionalInfo: [],
          },
        },
      ],
    } satisfies LegacyExport;
  };

  const optionsFor = (superAdminEmail: string, leaveOut: string[]): LegacyImportOptions => ({
    superAdminEmail,
    leaveOut,
    planKey: 'ENTERPRISE',
    markCollected: true,
    legacyKeyHex: legacyKey,
    keyCipher: createKeyCipher('ab'.repeat(32)),
    clock,
  });

  const emails = () => ({
    owner: `owner.${randomUUID()}@example.com`,
    other: `other.${randomUUID()}@example.com`,
    dropped: `support.${randomUUID()}@example.com`,
  });
  const userExists = async (email: string) =>
    (await db.identity.select().from(schema.users).where(eq(schema.users.email, email))).length > 0;
  const companyExists = (ruc: string) =>
    db.withSystem(
      'test: is the company there',
      async ({ db: tx }) =>
        (await tx.select().from(schema.tenants).where(eq(schema.tenants.ruc, ruc))).length > 0,
    );

  beforeAll(() => {
    db = appDatabase();
  });
  afterAll(() => db.close());

  it('imports the company, reconciles it, and it works as if made here', async () => {
    const ruc = testRuc();
    const people = emails();
    const data = exportOf(ruc, people);
    const { result, reconciliation } = await inOneTransaction(
      { connectionString: appUrl, logger: testLogger(), commit: true },
      async (one) => {
        const result = await importLegacyCompany(
          one,
          data,
          optionsFor(people.owner, [people.dropped]),
        );
        return { result, reconciliation: await reconcileLegacyImport(one, data, result) };
      },
    );
    expect(reconciliation.checks.filter((check) => !check.ok)).toEqual([]);
    expect(result).toMatchObject({
      clients: 2,
      products: 1,
      templates: 1,
      collected: 2,
      signedOnly: 1,
      problems: [],
    });
    // The delivery report has no place in the new timeline.
    expect(result.skippedEvents).toBe(2);

    const [owner] = await db.identity
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, people.owner));
    expect(owner).toMatchObject({ isSuperAdmin: true, emailVerified: true });
    expect(await userExists(people.other)).toBe(true);
    expect(await userExists(people.dropped)).toBe(false);

    const actor = await resolveActor(db, {
      userId: owner!.id,
      tenantId: result.realTenantId,
      clock,
    });
    // The numbering continues where it was; the imported documents used no quota.
    const [sequence] = await db.withTenant({ tenantId: result.realTenantId }, ({ db: tx }) =>
      tx
        .select({ next: schema.documentSequences.nextValue })
        .from(schema.documentSequences)
        .where(
          and(
            eq(schema.documentSequences.tenantId, result.realTenantId),
            eq(schema.documentSequences.documentType, '01'),
          ),
        ),
    );
    expect(sequence?.next).toBe(37);
    expect((await quotaUsage(actor, db)).used).toBe(0);
    // Collected on their day, so nothing is owed.
    expect((await agingReport(actor, db)).rows).toEqual([]);
    // The RIDE reads the stored XML.
    const [document] = await db.withTenant({ tenantId: result.realTenantId }, ({ db: tx }) =>
      tx.select().from(schema.documents).where(eq(schema.documents.sequential, 36)),
    );
    expect(rideData(document!.authorizationXml!)).toMatchObject({
      sequential: '000000036',
      total: '100.00',
    });
    expect(document).toMatchObject({ status: 'AUTHORIZED', total: '100.00', buyerIdType: '08' });

    // The previous system's bcrypt password signs in.
    const auth = createAuth({
      db: db.identity,
      secret: 'integration-test-secret-integration-test-secret',
      appUrl: 'http://localhost:3000',
      emails: { verification: () => Promise.resolve(), passwordReset: () => Promise.resolve() },
    });
    const identity = createIdentity({
      auth,
      db: db.identity,
      rateLimiter: createRateLimiter(db.identity, () => clock.now()),
      clock,
    });
    const meta = { ip: `203.0.113.${randomUUID()}`, headers: new Headers() };
    await expect(identity.signIn({ email: people.owner, password }, meta)).resolves.toBeDefined();
    await expect(
      identity.signIn({ email: people.owner, password: 'not the old password' }, meta),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('keeps nothing when it refuses: a document still waiting for SRI', async () => {
    const ruc = testRuc();
    const people = emails();
    const data = exportOf(ruc, people);
    data.documents[1]!.status = 'RECEIVED';
    await expect(
      inOneTransaction({ connectionString: appUrl, logger: testLogger(), commit: true }, (one) =>
        importLegacyCompany(one, data, optionsFor(people.owner, [])),
      ),
    ).rejects.toMatchObject({ code: 'LEGACY_IMPORT_REFUSED' });
    expect(await userExists(people.owner)).toBe(false);
  });

  it('keeps nothing when a step fails halfway: the wrong previous key', async () => {
    const ruc = testRuc();
    const people = emails();
    await expect(
      inOneTransaction({ connectionString: appUrl, logger: testLogger(), commit: true }, (one) =>
        importLegacyCompany(one, exportOf(ruc, people), {
          ...optionsFor(people.owner, []),
          legacyKeyHex: 'cd'.repeat(32),
        }),
      ),
    ).rejects.toThrow();
    // The accounts were written before the certificate failed; the rollback took them too.
    expect(await userExists(people.owner)).toBe(false);
    expect(await companyExists(ruc)).toBe(false);
  });

  it('refuses a company already here, and a dry run keeps nothing', async () => {
    const ruc = testRuc();
    const people = emails();
    await inOneTransaction(
      { connectionString: appUrl, logger: testLogger(), commit: false },
      (one) => importLegacyCompany(one, exportOf(ruc, people), optionsFor(people.owner, [])),
    );
    expect(await companyExists(ruc)).toBe(false);
    expect(await userExists(people.owner)).toBe(false);
  });
});
