# ADR-007: Testing and Code Quality Tooling

## Status
Accepted

## Date
2026-11-01

## Context

PRD section 14 sets the strategy and leaves three choices open: Testcontainers or local Docker Postgres, ESLint + Prettier or Biome, and how tests get a real role setup. Integration tests must run with RLS on, as a role that doesn't bypass it.

## Decision

**Vitest** for unit and integration, **Playwright** for E2E.

**Integration tests use the local `postgres18` container** in development and a `postgres:18` service in CI, against a dedicated `comprobify_erp_test` database. `GETTING_STARTED.md` covers creating that container when it doesn't exist, as the old repositories do, but with the named `postgres18_data` volume so data survives removing the container. The bootstrap script creating roles and databases is the same in both, is safe to re-run, and touches nothing belonging to other projects on the shared container. Tests connect as `comprobify_erp_app`, and refuse to run unless the database name ends in `_test`, as the old API does. Only fixtures that need DDL use the owner role.

**ESLint + Prettier.** ESLint is needed for `eslint-config-next` and the import-boundary rules (ADR-001). Prettier formats.

**CI on GitHub Actions**, per PRD section 12: lint, type-check, unit, integration, image build, dependency audit, and E2E smoke on `main`. CD is not part of Milestone 0: there is no staging or production infrastructure to deploy to, and the Milestone 0 gate is local.

**Fake clock from the start.** Core takes a `Clock` from its context, so Milestone 3 calendar tests need no refactor.

## Consequences

### Positive
- One Postgres to run, and the same setup path everywhere.
- Fast integration runs with no container per suite.
- Boundary rules fail in lint instead of review.

### Negative
- Tests share a database, so they need unique fixtures per test or tenant.
- Developers must have the container running and have run `pnpm db:setup` before integration tests.
- Two tools (ESLint, Prettier) are slower than Biome.

## Alternatives considered

- **Testcontainers**: isolated, but slower, needs Docker socket access in CI, and duplicates the role bootstrap.
- **Biome**: fast and one tool, but lacks `eslint-config-next` and boundary rules at the depth we need.
- **Jest**: used by the old API. Vitest handles TypeScript ESM directly, and `comprobify-web` already uses it.
