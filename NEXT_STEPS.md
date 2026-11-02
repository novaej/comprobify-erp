# Next Steps

Open work only. Tick steps as they land. When a milestone's gate passes, remove its section: `CHANGELOG.md` and git keep the history. Requirements and gates are in [docs/PRD.md](docs/PRD.md), section 15.

## Current: Milestone 0, Foundations

**Gate:** the empty app deploys locally with Docker, and the RLS catalog test passes.

- [x] **Step 1: repo and tooling.** Workspace, Turborepo, strict TypeScript, ESLint boundary rules, Prettier, `CLAUDE.md`, stack ADRs.
- [x] **Step 2: config and core basics.** Env validation, `.env.example`, logger, actor context, `DomainError`, `Clock`.
- [x] **Step 3: database.** `postgres18` setup in `GETTING_STARTED.md`, roles and databases, first migration, `withTenant` and `withSystem`, boot guard, RLS isolation and catalog tests.
- [ ] **Step 4: jobs.** pg-boss schema and queue registry, worker, `system.heartbeat`, transactional enqueue test, worker running without DDL rights.
- [ ] **Step 5: web.** `packages/ui`, theme shim, next-intl, localized page, error pages, `/health`, Sentry.
- [ ] **Step 6: packaging and gate.** Docker image, Compose stack with Caddy, CI, Playwright smoke test, remaining docs, gate run from a clean checkout.

## Upcoming milestones

- [ ] 1. Identity and tenancy
- [ ] 2. Entitlements and plans
- [ ] 3. SRI engine: factura
- [ ] 4. Other SRI documents
- [ ] 5. Inventory and purchasing
- [ ] 6. Sales
- [ ] 7. Bulk invoicing
- [ ] 8. Billing
- [ ] 9. Notifications, reports, admin
- [ ] 10. Production readiness and cutover
- [ ] 11+. Post-MVP: public API, API keys, webhooks, MCP, OAuth, developer docs

## Before the first push

- [ ] Owner makes `novaej/comprobify-erp` private. It's currently public.

## Open questions

See [docs/PRD.md](docs/PRD.md), section 17.
