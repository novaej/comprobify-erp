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

**pino** writes JSON to stdout, with `pino-pretty` only in local development. There is one `createLogger` factory in `packages/config`, because `packages/db` needs it and can't depend on core. Its fields are an allow-list (request id, tenant id, user id, job id, access key, and a few operational fields), so a header or query string can't be logged by spreading an object. Errors keep only their type, message, stack and code.

**Betterstack** ships through `@logtail/pino` when `BETTERSTACK_SOURCE_TOKEN` is set. **Sentry** (`@sentry/nextjs`, `@sentry/node`) is on only when a DSN is set, tagged with the request id. Org and project come from env, not from committed config as in the old app. Local development works with neither.

**Health.** `GET /health` checks a database query and the queue, and returns 503 on failure. It reveals no details. Deploys wait for it (PRD 9.4). It was planned to run in system context with a fixed reason, but its query touches no table, so it uses `db.ping()` with no context. That also keeps a system-context log line out of every probe.

**Sentry reports errors from three places:** the web server, through `onRequestError` with the request id as a tag; the worker, through job failures; and the browser, through `instrumentation-client.ts` and the error boundaries. The image is built once for every environment, so the browser can't have its DSN at build time: it reads it from `GET /api/client-config` when the page loads, and starts nothing when there is none. A DSN is public by design; it only lets one send events. An error thrown before that answer arrives isn't reported, which is accepted.

**Errors only, scrubbed.** Both web sides share `sentryOptions` (`apps/web/src/lib/sentry.ts`): `sendDefaultPii` off, and `beforeSend` and `beforeBreadcrumb` keep a URL to its path and drop cookies, headers, the query and the body, because links carry tokens (Appendix B lessons 5 and 6). Tracing is off on the web and the worker: in Milestone 10 a check against a fake Sentry found that the server's spans carry each request's headers, cookie and referer, query included, and `beforeSend` never sees spans. Session replay is never on. Turning either on needs its own scrubbing and a change to this ADR.

## Consequences

### Positive
- A misconfigured deploy fails at start with a clear list.
- Secrets can't appear in logs through accidental object spreading.
- Local setup needs no vendor accounts.

### Negative
- Adding a log field means changing the allow-list.
- No performance tracing in Sentry; slow requests and jobs are found from the logs.
- pino needs `serverExternalPackages` in Next.js, and transports need testing in the standalone output. Checked in Milestone 0: inside a Next build, pino resolves transports from `apps/web`, so `pino-pretty` and `@logtail/pino` are listed there as well as in `packages/config`.
- Each new variable touches the schema, `.env.example` and `docs/deployment.md`.

## Alternatives considered

- **winston**: used by the old API. pino is faster, and the worker's JSON logging needs no extra formatting layer.
- **Reading env in each package**: how lesson 9 happened.
