# ADR-008: Config Validation, Logging, Sentry

## Status
Accepted

## Date
2026-11-01

## Context

Two old incidents shape this: an empty env var parsed as `NaN` (Appendix B lesson 9), and auth headers reaching logs (lesson 6). PRD 9.3 requires secrets validated at startup, and 9.5 requires structured logs and Sentry. NFR-ARCH-5 forbids `process.env` in core.

## Decision

**`packages/config` is the only code that reads `process.env`.** It exposes Zod schemas per process (`web`, `worker`, `migrate`) and fails at startup listing every invalid variable, without printing values. Empty strings count as unset. Values reach core by injection.

**`APP_ENV` is `local | staging | production`**, separate from `NODE_ENV`. Config refuses `SRI_MOCK_MODE=true` when `APP_ENV=production`. Milestone 3 re-checks this at every SRI call (FR-ONB-6).

**`.env.example` is the env reference**, and a test fails if a schema variable is missing from it.

**pino** writes JSON to stdout, with `pino-pretty` only in local development. There is one `createLogger` factory. Its fields are an allow-list (request id, tenant id, user id, job id, access key), so a header or query string can't be logged by spreading an object. Redaction is a second layer, not the main control.

**Betterstack** ships through `@logtail/pino` when `BETTERSTACK_SOURCE_TOKEN` is set. **Sentry** (`@sentry/nextjs`, `@sentry/node`) is on only when a DSN is set, tagged with the request id. Org and project come from env, not from committed config as in the old app. Local development works with neither.

**Health.** `GET /health` checks a database query and the queue, and returns 503 on failure. It runs in system context with a fixed reason and reveals no details. Deploys wait for it (PRD 9.4).

## Consequences

### Positive
- A misconfigured deploy fails at start with a clear list.
- Secrets can't appear in logs through accidental object spreading.
- Local setup needs no vendor accounts.

### Negative
- Adding a log field means changing the allow-list.
- pino needs `serverExternalPackages` in Next.js, and transports need testing in the standalone output.
- Each new variable touches the schema, `.env.example` and `docs/deployment.md`.

## Alternatives considered

- **winston**: used by the old API. pino is faster, and the worker's JSON logging needs no extra formatting layer.
- **Reading env in each package**: how lesson 9 happened.
