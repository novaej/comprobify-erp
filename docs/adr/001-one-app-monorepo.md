# ADR-001: One App, One Worker, One Image, pnpm Monorepo

## Status
Accepted

## Date
2026-11-01

## Context

The current product is two systems with two databases, and much of its machinery exists only to keep them in sync (PRD Appendix B). The ERP needs order → invoice → stock in one transaction (FR-SAL-6), and the future public API must reuse the same logic (NFR-ARCH-1).

## Decision

**One pnpm workspace with Turborepo for task caching**, laid out as in PRD 7.2: `apps/web`, `apps/worker`, `packages/{core,db,ui,config}`.

**Internal packages ship TypeScript source.** They have no build step of their own. `apps/web` compiles them through `transpilePackages`; `apps/worker` is bundled with esbuild into one file. Types resolve through workspace `exports`, so a change in core needs no rebuild.

**One Docker image, two roles plus a one-shot step.** The same image runs `web`, `worker` and `migrate`, selected by command. Next.js uses `output: 'standalone'`. The base image is `node:24-slim` pinned by digest, with `libxml2-utils` installed now because SRI validation needs `xmllint` from Milestone 3.

**Module boundaries are checked by lint**, not by convention alone: `packages/core` can't import `next`, `react` or `apps/*`, can't read `process.env`, and modules can import each other only through `index.ts` (NFR-ARCH-4, NFR-ARCH-5).

## Consequences

### Positive
- One transaction can span every module.
- Web and worker can't drift, because they deploy as one image.
- The public API becomes another thin adapter over core.

### Negative
- The image carries both processes' dependencies.
- A bad deploy affects web and worker together.
- Source-only packages mean `transpilePackages` must list every workspace package.

## Alternatives considered

- **Nx**: more capable, but heavier than five packages need.
- **Building each package with tsup**: adds a watch step and stale `dist` problems for no benefit, since nothing is published.
- **Separate images for web and worker**: smaller, but brings back version drift. Worth revisiting if the worker moves to its own droplet (PRD 9.2).
