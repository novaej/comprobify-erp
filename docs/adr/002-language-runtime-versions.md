# ADR-002: TypeScript, Node 24, Exact Version Pinning

## Status
Accepted

## Date
2026-11-01

## Context

PRD section 10 asks for exact versions, latest stable at project start. The old API was plain JavaScript on `node:20-slim`, while the old web app was on Node 24. Latest stable isn't always installable: `typescript@7.0.2` is out, but `typescript-eslint@8.72.1` requires `typescript <6.1.0`, and `eslint-config-next` depends on it. TypeScript 7's main package export also no longer provides the classic compiler API, which it now offers only under `unstable/` paths, so other tools that load it may break too.

## Decision

**TypeScript strict everywhere, Node 24 LTS**, recorded in `engines`, `.nvmrc` and the image.

**TypeScript is held at 6.0.3**, the newest version the lint stack supports. Moving to 7 waits for `typescript-eslint` support and gets its own change.

**Every dependency uses an exact version**, with no `^` or `~` (`saveExact: true` in `pnpm-workspace.yaml`), and `pnpm-lock.yaml` is committed. `packageManager` pins pnpm.

Starting versions, checked against the npm registry on 2026-11-01:

| Package | Version | Package | Version |
|---|---|---|---|
| pnpm | 12.16.1 | zod | 4.6.7 |
| turbo | 2.11.10 | pg | 8.23.1 |
| next | 16.4.3 | drizzle-orm | 0.45.4 |
| react, react-dom | 19.3.1 | drizzle-kit | 0.31.11 |
| next-intl | 4.14.9 | pg-boss | 12.38.0 |
| tailwindcss | 4.3.3 | pino | 10.4.0 |
| vitest | 5.0.5 | @sentry/nextjs, @sentry/node | 11.10.0 |
| @playwright/test | 1.64.1 | eslint | 10.14.0 |
| prettier | 3.9.10 | typescript | 6.0.3 |

Other packages take their latest stable at install time and land in the lockfile. Container images (`postgres:18`, `caddy:2-alpine`, `node:24-slim`) are pinned by digest, as in the old repositories.

## Consequences

### Positive
- Builds are reproducible, and an upgrade is always a visible diff.
- A mutable tag can't change what ships.

### Negative
- Upgrades are manual, so dependency hygiene needs a regular pass.
- We start one major behind on TypeScript.

## Alternatives considered

- **TypeScript 7 with Biome instead of ESLint**: possible, but loses `eslint-config-next` and the import-boundary rules ADR-001 relies on.
- **Caret ranges with a lockfile**: the old repositories' approach. Rejected because the PRD asks for exact pins.
