import { randomUUID } from 'node:crypto';
import {
  createJobs,
  createKeyCipher,
  failedJobs,
  fixedClock,
  jobsOverview,
  onboardOrganization,
  overdueDocuments,
  retryFailedJob,
  type CreatedOrganization,
  type Jobs,
  type PlatformActor,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, insertTestDocument, superAdmin, testLogger } from './helpers';

// FR-ADM-5: the operator's view of the job queues, the failed jobs and the documents SRI holds.
describe('the jobs view', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let jobs: Jobs;
  let admin: PlatformActor;
  let org: CreatedOrganization;
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: jobs view setup', ({ executeSql }) => executeSql(text, values));
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    admin = { ...(await superAdmin(db)), clock };
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `jv.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: user!.id,
        ruc,
        legalName: 'Upsilon S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2026-01-01'),
            notAfter: new Date('2030-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher: createKeyCipher('b6'.repeat(32)), clock },
    );
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('counts every registered queue and shows what is scheduled', async () => {
    const queues = await jobsOverview(admin, db);
    const names = queues.map((queue) => queue.queue);
    expect(names).toContain('sri.send');
    expect(names).toContain('platform.notify');
    expect(queues.find((queue) => queue.queue === 'sri.overdue')!.schedule).toBe('*/15 * * * *');
    expect(queues.find((queue) => queue.queue === 'sri.send')!.schedule).toBeNull();
    expect(Object.keys(queues[0]!.counts).sort()).toEqual(
      ['active', 'cancelled', 'completed', 'created', 'failed', 'retry'].sort(),
    );
  });

  it('lists a failed job by its error, never its data, and puts it back in its queue', async () => {
    const id = (await jobs.boss.send('email.send', {
      to: 'secret@example.com',
      locale: 'es',
      template: 'verifyEmail',
      params: { url: 'https://app.test/es/verify?token=SECRET' },
    }))!;
    // As a worker's last failed try leaves it.
    await sql(
      `UPDATE pgboss.job SET state = 'failed', retry_count = 5, completed_on = now(), output = $2::jsonb WHERE id = $1`,
      [id, JSON.stringify({ message: 'Mailgun said no' })],
    );

    const failed = await failedJobs(admin, db);
    const job = failed.find((entry) => entry.id === id)!;
    expect(job).toMatchObject({ queue: 'email.send', message: 'Mailgun said no' });
    expect(JSON.stringify(failed)).not.toContain('SECRET');
    expect(
      (await jobsOverview(admin, db)).find((queue) => queue.queue === 'email.send')!.counts.failed,
    ).toBeGreaterThanOrEqual(1);

    await retryFailedJob(admin, db, { queue: 'email.send', id }, { jobs });
    expect((await failedJobs(admin, db)).map((entry) => entry.id)).not.toContain(id);
    const state = await sql(`SELECT state::text AS state FROM pgboss.job WHERE id = $1`, [id]);
    expect(state.rows[0]).toEqual({ state: 'retry' });
    const audit = await sql(
      `SELECT details FROM platform_audit_events WHERE action = 'job.retried' AND details->>'jobId' = $1`,
      [id],
    );
    expect(audit.rows).toHaveLength(1);

    // It is not failed any more, and nobody else may ask.
    expect(await failure(retryFailedJob(admin, db, { queue: 'email.send', id }, { jobs }))).toBe(
      'JOB_NOT_FAILED',
    );
    expect(
      await failure(retryFailedJob(admin, db, { queue: 'email.send', id: randomUUID() }, { jobs })),
    ).toBe('NOT_FOUND');
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Nadie', email: `jv.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    const notAdmin = { userId: user!.id, isSuperAdmin: true as const, clock };
    expect(await failure(jobsOverview(notAdmin, db))).toBe('FORBIDDEN');
    expect(await failure(failedJobs(notAdmin, db))).toBe('FORBIDDEN');
    expect(await failure(overdueDocuments(notAdmin, db))).toBe('FORBIDDEN');
  });

  it('lists the documents SRI has held for more than a day, across companies', async () => {
    const old = await insertTestDocument(db, org.realTenantId);
    const fresh = await insertTestDocument(db, org.realTenantId);
    const sent = await insertTestDocument(db, org.twinTenantId);
    for (const document of [old, fresh, sent])
      for (const status of ['PENDING_SEND', 'RECEIVED'])
        await sql('UPDATE documents SET status = $1 WHERE id = $2', [status, document.id]);
    await sql(`UPDATE documents SET received_at = $1 WHERE id = $2`, [
      new Date('2026-11-08T10:00:00Z'),
      old.id,
    ]);
    await sql(`UPDATE documents SET received_at = $1 WHERE id = $2`, [
      new Date('2026-11-10T14:00:00Z'),
      fresh.id,
    ]);
    await sql(`UPDATE documents SET received_at = $1 WHERE id = $2`, [
      new Date('2026-11-07T10:00:00Z'),
      sent.id,
    ]);
    const rows = await overdueDocuments(admin, db);
    const ids = rows.map((row) => row.id);
    expect(ids).toContain(old.id);
    expect(ids).not.toContain(fresh.id);
    // The test copy's is told apart from the real company's.
    expect(rows.find((row) => row.id === old.id)).toMatchObject({
      company: 'Upsilon S.A.',
      isTwin: false,
      documentType: '01',
    });
    expect(rows.find((row) => row.id === sent.id)!.isTwin).toBe(true);
    expect(rows.find((row) => row.id === old.id)!.number).toMatch(/^001-001-\d{9}$/);
    // Oldest first.
    expect(ids.indexOf(sent.id)).toBeLessThan(ids.indexOf(old.id));
  });
});
