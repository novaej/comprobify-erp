import { randomUUID } from 'node:crypto';
import { createJobs, type Jobs } from '@comprobify/core';
import type { Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { appDatabase, appUrl, asOwner, createProbe, probeName, testLogger } from './helpers';

const QUEUE = 'system.heartbeat';

// ADR-005, CLAUDE.md rule 10, NFR-JOB-2, NFR-SEC-4.
describe('jobs', () => {
  const table = probeName('jobs');
  const tenantId = randomUUID();
  const logger = testLogger();
  let db: Database;
  let jobs: Jobs;

  const jobExists = (id: string): Promise<boolean> =>
    db.withSystem('jobs test', async (tx) => {
      const { rows } = await tx.executeSql('SELECT 1 FROM pgboss.job WHERE id = $1', [id]);
      return rows.length === 1;
    });

  beforeAll(async () => {
    await asOwner((owner) => createProbe(owner, table, true));
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'worker', logger });
    await jobs.start();
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
    await asOwner((owner) => owner.query(`DROP TABLE public.${table}`));
  });

  it('runs on a role with no DDL rights on pgboss', async () => {
    const rights = await db.withSystem('jobs test', async (tx) => {
      const { rows } = await tx.executeSql<{ creates: boolean; superuser: boolean }>(
        `SELECT has_schema_privilege(current_user, 'pgboss', 'CREATE') AS creates,
                rolsuper AS superuser
         FROM pg_roles WHERE rolname = current_user`,
      );
      return rows[0];
    });
    expect(rights).toEqual({ creates: false, superuser: false });
  });

  it('commits a job with the business write', async () => {
    const id = await db.withTenant({ tenantId }, async (tx) => {
      await tx.executeSql(`INSERT INTO ${table} (tenant_id, label) VALUES ($1, 'kept')`, [
        tenantId,
      ]);
      return jobs.enqueue(tx, QUEUE, {});
    });
    expect(id).toEqual(expect.any(String));
    await expect(jobExists(id as string)).resolves.toBe(true);
  });

  it('removes the job when the transaction rolls back', async () => {
    let id: string | null = null;
    await expect(
      db.withTenant({ tenantId }, async (tx) => {
        await tx.executeSql(`INSERT INTO ${table} (tenant_id, label) VALUES ($1, 'gone')`, [
          tenantId,
        ]);
        id = await jobs.enqueue(tx, QUEUE, {});
        // Visible inside the transaction, so the rollback below is what removes it.
        const { rows } = await tx.executeSql('SELECT 1 FROM pgboss.job WHERE id = $1', [id]);
        expect(rows).toHaveLength(1);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(id).not.toBeNull();
    await expect(jobExists(id as unknown as string)).resolves.toBe(false);
    const labels = await db.withTenant({ tenantId }, async (tx) => {
      const { rows } = await tx.executeSql(`SELECT 1 FROM ${table} WHERE label = 'gone'`);
      return rows.length;
    });
    expect(labels).toBe(0);
  });

  it('works an enqueued job as the app role', async () => {
    const id = await db.withTenant({ tenantId }, (tx) => jobs.enqueue(tx, QUEUE, {}));
    expect(id).not.toBeNull();
    // Earlier tests left jobs in this queue, so wait for this one.
    await new Promise<void>((resolve) => {
      void jobs.work(QUEUE, (job) => {
        if (job.id === id) resolve();
        return Promise.resolve();
      });
    });
    await jobs.boss.offWork(QUEUE, { wait: true });
  }, 15_000);

  it('logs a failed job and leaves it failed', async () => {
    const id = await db.withTenant({ tenantId }, (tx) => jobs.enqueue(tx, QUEUE, {}));
    await new Promise<void>((resolve) => {
      void jobs.work(QUEUE, (job) => {
        if (job.id !== id) return Promise.resolve();
        setTimeout(resolve, 200);
        return Promise.reject(new Error('handler broke'));
      });
    });
    await jobs.boss.offWork(QUEUE, { wait: true });

    expect(logger.error).toHaveBeenCalledWith(
      'Job failed',
      expect.objectContaining({ event: 'jobs.failed', jobId: id }),
    );
    vi.mocked(logger.error).mockClear();
    const job = await jobs.boss.getJobById(QUEUE, id as string);
    expect(job?.state).toBe('failed');
  }, 15_000);

  it('applies the schedule in Ecuador time', async () => {
    await jobs.applySchedules();
    const [schedule] = await jobs.boss.getSchedules(QUEUE);
    expect(schedule).toMatchObject({
      data: {},
      name: QUEUE,
      cron: '*/5 * * * *',
      timezone: 'America/Guayaquil',
    });
  });

  it('runs maintenance as the app role without errors', async () => {
    await jobs.boss.supervise();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
