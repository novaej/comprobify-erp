import { randomUUID } from 'node:crypto';
import {
  addModule,
  cancelPurchaseOrder,
  createJobs,
  createNoEmailProvider,
  createOrganization,
  createProduct,
  createProvider,
  createPurchaseOrder,
  emailPurchaseOrder,
  fixedClock,
  getPurchaseOrder,
  orderWarehouses,
  purchaseOrderPdf,
  resolveActor,
  sendPurchaseOrderEmail,
  type ActorContext,
  type CreatedOrganization,
  type EmailMessage,
  type Jobs,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, superAdmin, testLogger } from './helpers';

// FR-PUR-3; CLAUDE.md rule 10.
describe('emailing a purchase order to the provider', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let jobs: Jobs;
  let org: CreatedOrganization;
  let owner: ActorContext;
  let providerId: string;
  let warehouseId: string;
  let productId: string;
  const sent: EmailMessage[] = [];
  const provider = {
    send: (message: EmailMessage) => {
      sent.push(message);
      return Promise.resolve('sent' as const);
    },
  };

  const jobsFor = async (orderId: string) =>
    (
      await db.withSystem('test: read purchase order email jobs', ({ executeSql }) =>
        executeSql<{ data: { tenantId: string; orderId: string; to: string[] } }>(
          `SELECT data FROM pgboss.job WHERE name = 'purchasing.email' AND data->>'orderId' = $1 ORDER BY created_on`,
          [orderId],
        ),
      )
    ).rows.map((row) => row.data);
  const draft = () =>
    createPurchaseOrder(owner, db, {
      providerId,
      warehouseId,
      expectedDate: '2026-11-20',
      lines: [{ productId, quantity: '12', unitCost: '1.25' }],
    });

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `poe.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    org = await createOrganization(db, {
      ownerUserId: user!.id,
      ruc: testRuc(),
      legalName: 'Sigma S.A.',
      tradeName: null,
      mainAddress: 'Av. Amazonas, Quito',
      branch: { code: '001', name: 'Matriz', address: 'Bodega norte, Quito' },
      issuePointCode: '001',
    });
    await addModule(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      moduleKey: 'PURCHASING',
    });
    owner = await resolveActor(db, { userId: user!.id, tenantId: org.realTenantId, clock });
    providerId = (
      await createProvider(owner, db, {
        idType: '04',
        identification: '1790012345001',
        name: 'Distribuidora Andina S.A.',
        emails: ['compras@andina.ec'],
      })
    ).id;
    warehouseId = (await orderWarehouses(owner, db))[0]!.id;
    productId = (
      await createProduct(owner, db, {
        code: 'CAF-1',
        name: 'Café en grano',
        kind: 'GOOD',
        price: '3',
        ivaRateCode: '4',
      })
    ).id;
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('sends a draft: the order becomes sent and the email job is enqueued with it', async () => {
    const order = await draft();
    await emailPurchaseOrder(
      owner,
      db,
      { id: order.id, to: ['Compras@Andina.ec', 'compras@andina.ec', 'gerencia@andina.ec'] },
      { jobs },
    );
    const view = await getPurchaseOrder(owner, db, order.id);
    expect(view.status).toBe('SENT');
    expect(view.sentAt).toEqual(clock.now());
    const [job] = await jobsFor(order.id);
    expect(job).toEqual({
      tenantId: org.realTenantId,
      orderId: order.id,
      to: ['compras@andina.ec', 'gerencia@andina.ec'],
    });

    sent.length = 0;
    await sendPurchaseOrderEmail({ db, provider, clock, logger: testLogger() }, job!);
    expect(sent.map((message) => message.to)).toEqual(['compras@andina.ec', 'gerencia@andina.ec']);
    const [message] = sent;
    // The twin isn't involved: the real company's order says nothing about tests.
    expect(message!.subject).toBe(`Orden de compra OC-000001 — Sigma S.A.`);
    expect(message!.fromName).toBe('Sigma S.A. via Comprobify');
    expect(message!.text).toContain('Entrega prevista:  20/11/2026');
    expect(message!.text).toContain('Total:  $17.25');
    expect(message!.attachments).toEqual([
      expect.objectContaining({
        filename: 'Orden de compra OC-000001.pdf',
        contentType: 'application/pdf',
      }),
    ]);
    expect(message!.attachments![0]!.content.subarray(0, 5).toString()).toBe('%PDF-');
    const emailed = await getPurchaseOrder(owner, db, order.id);
    expect(emailed.emailedTo).toEqual(['compras@andina.ec', 'gerencia@andina.ec']);
    expect(emailed.emailedAt).toEqual(clock.now());

    // Sent again: still SENT, another job.
    await emailPurchaseOrder(owner, db, { id: order.id, to: ['compras@andina.ec'] }, { jobs });
    expect(await jobsFor(order.id)).toHaveLength(2);
  });

  it('refuses a cancelled order, and a job for one cancelled since sends nothing', async () => {
    const order = await draft();
    await emailPurchaseOrder(owner, db, { id: order.id, to: ['compras@andina.ec'] }, { jobs });
    const [job] = await jobsFor(order.id);
    await cancelPurchaseOrder(owner, db, { id: order.id, reason: 'Ya no se necesita' });
    sent.length = 0;
    await sendPurchaseOrderEmail({ db, provider, clock, logger: testLogger() }, job!);
    expect(sent).toEqual([]);
    await expect(
      emailPurchaseOrder(owner, db, { id: order.id, to: ['compras@andina.ec'] }, { jobs }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_EMAILABLE' });
  });

  it('records nothing when email is off, and refuses a bad address before anything changes', async () => {
    const order = await draft();
    await expect(
      emailPurchaseOrder(owner, db, { id: order.id, to: ['not an email'] }, { jobs }),
    ).rejects.toThrow();
    expect((await getPurchaseOrder(owner, db, order.id)).status).toBe('DRAFT');
    await emailPurchaseOrder(owner, db, { id: order.id, to: ['compras@andina.ec'] }, { jobs });
    const [job] = await jobsFor(order.id);
    await sendPurchaseOrderEmail(
      { db, provider: createNoEmailProvider(), clock, logger: testLogger() },
      job!,
    );
    expect((await getPurchaseOrder(owner, db, order.id)).emailedAt).toBeNull();
  });

  it('marks the test copy as a test, in the subject', async () => {
    const twin = await resolveActor(db, {
      userId: owner.userId!,
      tenantId: org.twinTenantId,
      clock,
    });
    const twinProvider = await createProvider(twin, db, {
      idType: '04',
      identification: '1790012345001',
      name: 'Andina',
      emails: ['pruebas@andina.ec'],
    });
    const twinProduct = await createProduct(twin, db, {
      code: 'X',
      name: 'X',
      kind: 'GOOD',
      price: '1',
      ivaRateCode: '0',
    });
    const order = await createPurchaseOrder(twin, db, {
      providerId: twinProvider.id,
      warehouseId: (await orderWarehouses(twin, db))[0]!.id,
      lines: [{ productId: twinProduct.id, quantity: '1', unitCost: '1' }],
    });
    await emailPurchaseOrder(twin, db, { id: order.id, to: ['pruebas@andina.ec'] }, { jobs });
    const [job] = await jobsFor(order.id);
    sent.length = 0;
    await sendPurchaseOrderEmail({ db, provider, clock, logger: testLogger() }, job!);
    expect(sent[0]!.subject).toMatch(/^\[PRUEBAS\] Orden de compra OC-000001/);
    expect(sent[0]!.text).toContain('no es un pedido real');
  });

  it('gives the PDF to whoever can read orders', async () => {
    const order = await draft();
    const pdf = await purchaseOrderPdf(owner, db, order.id);
    expect(pdf.filename).toMatch(/^Orden de compra OC-\d{6}\.pdf$/);
    expect(pdf.content.subarray(0, 5).toString()).toBe('%PDF-');
    await expect(
      purchaseOrderPdf({ ...owner, permissions: [] }, db, order.id),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
