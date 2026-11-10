import { randomBytes, randomUUID } from 'node:crypto';
import {
  acceptAgreements,
  acceptInvitation,
  addModule,
  applyMovement,
  createClient,
  createProduct,
  createProvider,
  createPurchaseOrder,
  createSaleOrder,
  confirmSaleOrder,
  getPurchaseOrder,
  getSaleOrder,
  markPurchaseOrderSent,
  receivePurchaseOrder,
  createAuth,
  createJobs,
  createKeyCipher,
  createRateLimiter,
  createVerifiedUser,
  fixedClock,
  inviteMember,
  orderWarehouses,
  paymentCode,
  onboardOrganization,
  recordSessionStart,
  resolveActor,
  setIssuePointAccess,
  type CreatedOrganization,
  type Jobs,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appDatabase,
  appUrl,
  grantSeats,
  insertTestDocument,
  superAdmin,
  testLogger,
} from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const parties = {
  operator: {
    name: 'Operadora',
    ruc: '1712345678001',
    address: 'Quito',
    supportEmail: 'soporte@example.com',
  },
};

// Milestone 1 gate (NFR-SEC-1): every tenant table, found from the catalog rather than
// a list, holds rows for two companies and a twin, and no company sees another's.
describe('isolation sweep over every tenant table', () => {
  const clock = fixedClock(new Date().toISOString());
  let db: Database;
  let jobs: Jobs;
  let tables: string[];
  const orgs: CreatedOrganization[] = [];

  // A company with a row in every tenant table built so far.
  const populate = async (auth: ReturnType<typeof createAuth>) => {
    const email = `sw.${randomUUID()}@example.com`;
    const { id: owner } = await createVerifiedUser(auth, {
      name: 'Owner',
      email,
      password: 'correct horse battery',
      locale: 'es',
    });
    const ruc = testRuc();
    const org = await onboardOrganization(
      db,
      {
        ownerUserId: owner,
        ruc,
        legalName: `Sweep ${ruc}`,
        tradeName: null,
        mainAddress: 'Quito',
        branch: { code: '001', name: 'Matriz', address: null },
        issuePointCode: '001',
        certificate: { file: createTestP12({ ruc }), password: 'secret' },
        logo: PNG,
      },
      { keyCipher: createKeyCipher('e'.repeat(64)), clock },
    );
    await grantSeats(db, org);
    const ctx = await resolveActor(db, { userId: owner, tenantId: org.realTenantId, clock });
    const memberEmail = `swi.${randomUUID()}@example.com`;
    const invited = await createVerifiedUser(auth, {
      name: 'Invited',
      email: memberEmail,
      password: 'correct horse battery',
      locale: 'es',
    });
    await inviteMember(
      ctx,
      db,
      { email: memberEmail, role: 'SALES', locale: 'es' },
      {
        jobs,
        appUrl: 'http://app.test',
        rateLimiter: createRateLimiter(db.identity, () => clock.now()),
      },
    );
    const token = await db.withSystem('test: read the invitation token', async ({ executeSql }) => {
      const { rows } = await executeSql<{ url: string }>(
        `SELECT data->'params'->>'url' AS url FROM pgboss.job WHERE name = 'email.send' AND data->>'to' = $1 ORDER BY created_on DESC LIMIT 1`,
        [memberEmail],
      );
      return new URL(rows[0]!.url).searchParams.get('token')!;
    });
    await acceptInvitation(db, { token, userId: invited.id, userEmail: memberEmail }, clock);
    await setIssuePointAccess(ctx, db, {
      userId: invited.id,
      points: [{ branchCode: '001', pointCode: '001' }],
    });
    // A second, still pending invitation keeps a row in invitations.
    await inviteMember(
      ctx,
      db,
      { email: `swp.${randomUUID()}@example.com`, role: 'VIEWER', locale: 'es' },
      {
        jobs,
        appUrl: 'http://app.test',
        rateLimiter: createRateLimiter(db.identity, () => clock.now()),
      },
    );
    // grantSeats wrote an override; an add-on fills subscription_items.
    await addModule(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      moduleKey: 'INVENTORY',
    });
    await addModule(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      moduleKey: 'PURCHASING',
    });
    await addModule(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      moduleKey: 'SALES',
    });
    await acceptAgreements(ctx, db, { ipAddress: '203.0.113.9', userAgent: 'Sweep' }, parties);
    for (const tenantId of [org.realTenantId, org.twinTenantId]) {
      await recordSessionStart(db, { tenantId, userId: owner, sessionId: randomUUID() });
      // Clients and products: each tenant, the twin included, keeps its own (FR-MD-1, FR-MD-2).
      const actor = await resolveActor(db, { userId: owner, tenantId, clock });
      const client = await createClient(actor, db, {
        idType: '05',
        identification: '1710034065',
        name: 'Cliente',
      });
      const supplier = await createProvider(actor, db, {
        idType: '05',
        identification: '1710034065',
        name: 'Proveedor',
      });
      // Documents, lines, payments, events and a re-issue (FR-DOC-6, FR-DOC-13).
      const document = await insertTestDocument(db, tenantId);
      await db.withSystem('test: record a re-issue', ({ db: tx }) =>
        tx.insert(schema.documentReissues).values({
          tenantId,
          documentId: document.id,
          reason: 'MANUAL',
          previousAccessKey: `${document.accessKey.slice(0, 48)}9`,
          previousIssueDate: '2026-11-09',
          previousSignedXml: '<factura/>',
          accessKey: document.accessKey,
          issueDate: '2026-11-10',
        }),
      );
      await db.withSystem('test: record a call to SRI', ({ db: tx }) =>
        tx.insert(schema.sriExchanges).values({
          tenantId,
          documentId: document.id,
          operation: 'reception',
          outcome: 'RECEIVED',
          httpStatus: 200,
          raw: '<RespuestaRecepcionComprobante/>',
          durationMs: 12,
          source: 'mock',
        }),
      );
      await db.withSystem('test: save a template', ({ db: tx }) =>
        tx.insert(schema.documentTemplates).values({ tenantId, name: 'Plantilla', content: {} }),
      );
      await db.withSystem('test: keep a signed version', ({ db: tx }) =>
        tx.insert(schema.documentVersions).values({
          tenantId,
          documentId: document.id,
          reason: 'CREATED',
          revision: 1,
          accessKey: document.accessKey,
          issueDate: '2026-11-10',
          signedXml: '<factura/>',
        }),
      );
      const product = await createProduct(actor, db, {
        code: 'P-1',
        name: 'Producto',
        kind: 'GOOD',
        price: '1.00',
        ivaRateCode: '4',
        tracksStock: true,
      });
      // A stock level and its movement (FR-INV-1, FR-INV-2).
      await db.withTenant({ tenantId }, async (tx) => {
        const [warehouse] = await tx.db.select().from(schema.warehouses);
        await applyMovement(actor, tx, {
          type: 'OPENING_BALANCE',
          productId: product.id,
          warehouseId: warehouse!.id,
          quantity: '1',
          unitCost: '1',
        });
      });
      // A purchase order, its line and its number (FR-PUR-1).
      const [warehouse] = await orderWarehouses(actor, db);
      const order = await createPurchaseOrder(actor, db, {
        providerId: supplier.id,
        warehouseId: warehouse!.id,
        lines: [{ productId: product.id, quantity: '2', unitCost: '0.80' }],
      });
      // And a receipt with its line (FR-PUR-2).
      await markPurchaseOrderSent(actor, db, order.id);
      const [orderLine] = (await getPurchaseOrder(actor, db, order.id)).lines;
      await receivePurchaseOrder(actor, db, {
        orderId: order.id,
        lines: [{ lineId: orderLine!.id, quantity: '1' }],
      });
      // A sale order, confirmed so it holds stock (FR-SAL-1, FR-SAL-2).
      const sale = await createSaleOrder(actor, db, {
        clientId: client.id,
        warehouseId: warehouse!.id,
        lines: [{ productId: product.id, quantity: '1', unitPrice: '1.50', discount: '0' }],
      });
      await confirmSaleOrder(actor, db, sale.id);
      // A payment received for an invoice (FR-SAL-10).
      await db.withSystem('test: record a payment received', ({ db: tx }) =>
        tx.insert(schema.invoicePayments).values({
          tenantId,
          documentId: document.id,
          amount: '1.00',
          paidOn: '2026-11-10',
          method: '01',
        }),
      );
      // And an invoice covering part of it (FR-SAL-3).
      const [saleLine] = (await getSaleOrder(actor, db, sale.id)).lines;
      await db.withSystem('test: link an invoice to a sale order', ({ db: tx }) =>
        tx.insert(schema.saleOrderInvoiceLines).values({
          tenantId,
          orderId: sale.id,
          orderLineId: saleLine!.id,
          documentId: document.id,
          documentRevision: 1,
          quantity: '1',
        }),
      );
      // A payment and its proof (FR-BILL-2, FR-BILL-3).
      await db.withSystem('test: record a payment', async ({ db: tx, executeSql }) => {
        const { rows } = await executeSql<{ id: string }>(
          `SELECT id FROM subscriptions WHERE tenant_id = $1`,
          [tenantId],
        );
        const [payment] = await tx
          .insert(schema.payments)
          .values({
            tenantId,
            subscriptionId: rows[0]!.id,
            code: paymentCode(),
            purpose: 'RENEWAL',
            baseAmount: '10.00',
            ivaRate: '15.00',
            ivaAmount: '1.50',
            totalAmount: '11.50',
          })
          .returning({ id: schema.payments.id });
        await tx.insert(schema.paymentProofs).values({
          tenantId,
          paymentId: payment!.id,
          filename: 'pago.png',
          contentType: 'image/png',
          content: PNG,
          size: PNG.length,
          reference: 'SPI-1',
        });
        // A pack it bought (FR-BILL-7).
        await tx
          .insert(schema.documentPacks)
          .values({ tenantId, paymentId: payment!.id, size: 100 });
        // A card attempt at it (FR-BILL-3).
        await tx.insert(schema.payphoneTransactions).values({
          tenantId,
          paymentId: payment!.id,
          clientTransactionId: randomBytes(8).toString('hex'),
          amountCents: 1150,
        });
      });
      // A notification, its receipt and a choice about it (FR-NOT-1).
      await db.withSystem('test: notify a member', async ({ db: tx }) => {
        const [notification] = await tx
          .insert(schema.notifications)
          .values({
            tenantId,
            type: 'RENEWAL_DUE',
            params: { date: '2026-12-10' },
            link: '/plan',
            environment: 'PRODUCTION',
          })
          .returning({ id: schema.notifications.id });
        await tx
          .insert(schema.notificationReceipts)
          .values({ tenantId, notificationId: notification!.id, userId: owner });
        await tx.insert(schema.notificationPreferences).values({
          tenantId,
          userId: owner,
          type: 'RENEWAL_DUE',
          channel: 'EMAIL',
          enabled: false,
        });
      });
      // A batch with an item that made an invoice, and one still waiting (FR-BULK-1).
      await db.withSystem('test: start a batch', async ({ db: tx, executeSql }) => {
        const { rows } = await executeSql<{ id: string }>(
          `SELECT id FROM issue_points WHERE tenant_id = $1 LIMIT 1`,
          [tenantId],
        );
        const [batch] = await tx
          .insert(schema.bulkBatches)
          .values({
            tenantId,
            source: 'SALE_ORDERS',
            issuePointId: rows[0]!.id,
            paymentMethod: '01',
            totalItems: 2,
          })
          .returning({ id: schema.bulkBatches.id });
        await tx.insert(schema.bulkBatchItems).values([
          {
            tenantId,
            batchId: batch!.id,
            position: 1,
            status: 'CREATED',
            saleOrderId: sale.id,
            documentId: document.id,
          },
          { tenantId, batchId: batch!.id, position: 2, saleOrderId: sale.id },
        ]);
      });
    }
    return org;
  };

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    const auth = createAuth({
      db: db.identity,
      secret: 'integration-test-secret-integration-test-secret',
      appUrl: 'http://app.test',
      emails: { verification: () => Promise.resolve(), passwordReset: () => Promise.resolve() },
    });
    orgs.push(await populate(auth), await populate(auth));
    tables = await db.withSystem(
      'test: list tenant tables from the catalog',
      async ({ executeSql }) => {
        const { rows } = await executeSql<{ name: string }>(
          `SELECT c.relname AS name FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname NOT LIKE 'probe\\_%'
         ORDER BY 1`,
        );
        return rows.map((row) => row.name);
      },
    );
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('finds the tenant tables built so far', () => {
    expect(tables).toEqual(
      expect.arrayContaining([
        'agreement_acceptances',
        'audit_events',
        'branches',
        'bulk_batch_items',
        'bulk_batches',
        'certificates',
        'clients',
        'document_events',
        'document_lines',
        'document_payments',
        'document_reissues',
        'document_sequences',
        'document_templates',
        'document_versions',
        'document_packs',
        'documents',
        'invitations',
        'issue_point_document_types',
        'issue_point_access',
        'invoice_payments',
        'issue_points',
        'memberships',
        'notification_preferences',
        'notification_receipts',
        'notifications',
        'payment_proofs',
        'payments',
        'payphone_transactions',
        'products',
        'providers',
        'purchase_order_lines',
        'purchase_orders',
        'purchase_receipt_lines',
        'purchase_receipts',
        'sale_order_invoice_lines',
        'sale_order_lines',
        'sale_orders',
        'sri_exchanges',
        'stock_levels',
        'stock_movements',
        'subscription_items',
        'subscriptions',
        'tenant_counters',
        'tenant_feature_overrides',
        'tenant_logos',
        'warehouses',
      ]),
    );
  });

  it('has rows for every company in every tenant table', async () => {
    const empty: string[] = [];
    for (const table of tables) {
      for (const org of orgs) {
        const count = await db.withSystem(
          'test: count rows per company',
          async ({ executeSql }) => {
            const { rows } = await executeSql<{ n: number }>(
              `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = ANY($1)`,
              [[org.realTenantId, org.twinTenantId]],
            );
            return rows[0]!.n;
          },
        );
        if (count === 0) empty.push(table);
      }
    }
    // Otherwise the next test would pass for a table with nothing to hide.
    expect(empty).toEqual([]);
  });

  it('shows each company, and each twin, only its own rows in every tenant table', async () => {
    const leaks: string[] = [];
    const tenants = orgs.flatMap((org) => [org.realTenantId, org.twinTenantId]);
    for (const tenantId of tenants) {
      for (const table of tables) {
        const foreign = await db.withTenant({ tenantId }, async ({ executeSql }) => {
          const { rows } = await executeSql<{ n: number }>(
            `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id <> $1`,
            [tenantId],
          );
          return rows[0]!.n;
        });
        if (foreign > 0) leaks.push(`${table} seen from ${tenantId}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});
