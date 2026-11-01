# ADR-005: Jobs and Schedules on pg-boss

## Status
Accepted

## Date
2026-11-01

## Context

The old system needed RabbitMQ, a `pending_effects` outbox, a reconciliation sweep and droplet cron to deliver work reliably. A queue in the same database as the business write removes all four (PRD 7.1), as long as enqueuing really can join the business transaction.

Checked against `pg-boss@12.38.0`:

- `send()` accepts a per-call `db` option (`ConnectionOptions`), so a job can be inserted on our open transaction.
- Schedules take a `tz` option.
- `createQueue()` calls a SQL function that runs `CREATE TABLE`, so it needs DDL rights.
- The constructor accepts `migrate: false`, `createSchema: false` and `schedule` and `supervise` switches.

## Decision

**pg-boss in its own `pgboss` schema.** Schema install and upgrades run in the `migrate` step as `comprobify_erp_owner`.

**Queues are a code registry** in `packages/core/src/jobs/`: name, policy, retry and concurrency settings. The migrate step reads it and creates the queues. Web and worker never run DDL, which keeps the app role free of it (NFR-SEC-4). `comprobify_erp_app` gets DML on the `pgboss` schema, including `DELETE`, since pg-boss's own maintenance needs it.

**Web only sends; the worker works.** Web starts pg-boss with `schedule: false` and `supervise: false`. The worker owns handlers, cron schedules and maintenance.

**Transactional enqueue is the only path for business jobs:**

```ts
await withTenant(ctx, async (tx) => {
  await tx.db.insert(documents).values(row);
  await enqueue(tx, 'sri.send', { documentId }); // same commit
});
```

**Schedules are declared in code** with `America/Guayaquil` (NFR-JOB-2), and applied at worker start. **SRI queues are separate** from email queues, with their own concurrency (NFR-JOB-3).

Milestone 0 proves the wiring with one `system.heartbeat` queue and schedule. It proves a rollback removes the job, and that the worker runs as `comprobify_erp_app` with no DDL rights. If maintenance turns out to need `CREATE` on the `pgboss` schema, that single grant is the fallback, recorded here.

## Consequences

### Positive
- The outbox guarantee comes natively: no commit, no job.
- No broker to run, and queue state is covered by database backups.
- Adding a queue is one registry entry and a deploy.

### Negative
- Queue load shares the database with the application, which matters at the PRD 9.1 peaks.
- Adding a queue needs a migrate step, so a new queue can't appear at runtime.
- Each pg-boss major needs its schema upgrade rehearsed before deploy.

## Alternatives considered

- **RabbitMQ with an outbox**: what we're leaving behind.
- **BullMQ**: needs Redis and can't enqueue transactionally.
- **Granting the app role `CREATE` on `pgboss`**: simpler, and it's the fallback, but it gives web a DDL right it doesn't need.
