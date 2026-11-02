# Next Steps

Open work only. Tick steps as they land. When a milestone's gate passes, remove its section: `CHANGELOG.md` and git keep the history. Requirements and gates are in [docs/PRD.md](docs/PRD.md), section 15.

## Current: Milestone 1, Identity and tenancy

**Gate:** two tenants and a tenant/twin pair fully isolated (integration); the ambiente rule covered for every deployment × mode cell; invite and role restrictions (E2E).

- [x] **Step 1: auth decision.** ADR-009 (PRD open question 7), after a spike.
- [x] **Step 2: identity.** Better Auth with uuid identity tables, sign-up, email verification (`GET` checks, `POST` consumes), login, logout, password reset, idle timeout and absolute lifetime, sign out everywhere, rate limits per vector, an `email.send` job with a Mailgun adapter, which logs instead of sending when Mailgun isn't configured.
- [ ] **Step 3: tenancy model.** Tenants (`mode`, `twin_of`), branches, issue points, warehouses created with each branch, memberships, roles and permissions in core, the actor context from the session, the ambiente function with every deployment × mode cell tested.
- [ ] **Step 4: onboarding.** The wizard creating the real organization and its twin with the same branches and issue points, RUC checks, P12 upload encrypted with AES-256-GCM and stored on both, logo.
- [ ] **Step 5: app shell.** Sidebar layout, organization switcher with the Producción / Pruebas toggle, sandbox banner, certificate banner.
- [ ] **Step 6: users and roles.** Invites (`GET` checks, `POST` accepts), role changes, soft removal, issue-point restrictions, optional TOTP and the tenant setting that requires it.
- [ ] **Step 7: go-live, agreements, audit.** Legal agreements with per-tenant snapshots and acceptance events, go-live (Owner, verified email, accepted agreements), twin reset, the tenant audit log.
- [ ] **Step 8: gate.** Isolation tests for two tenants and a tenant/twin pair, the ambiente matrix, invite and role E2E, docs.

Seat limits (FR-USR-1) need entitlements, so they arrive in Milestone 2. Go-live copies master data, which arrives in Milestones 5 and 6; Milestone 1 builds the go-live step that later milestones extend.

## Upcoming milestones

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

## Hardening backlog

Hardening deferred by an earlier milestone. Add an item whenever a milestone puts one off, with where it's recorded. Milestone 10 works through the list, and its gate needs it empty or each remaining item accepted by the owner.

- [ ] TLS for managed Postgres connections, verified against DigitalOcean (`docs/deployment.md`).
- [ ] Slimmer Docker image: 1.45 GB with the full `node_modules` (`Dockerfile`).
- [ ] Browser-side Sentry, with the DSN from the server at runtime (ADR-008).
- [ ] Moderate audit findings in Sentry's dependencies (`glob`, `minimatch`). Recheck on each Sentry upgrade.
- [ ] Automated dependency updates (Renovate or Dependabot).
- [ ] Revisit a separate role for system context: `app.rls_system` is a setting, not a privilege (ADR-004).
- [ ] pg-boss index rebuilds: automatic `REINDEX` is off, so bloat reports need a manual owner task (ADR-005).
- [ ] Web shutdown: stop pg-boss and close the pool on `SIGTERM`, as the worker does.

## Before the old repositories are deleted

The owner will delete `comprobify` and `comprobify-web`, so this repo must not depend on them (`CLAUDE.md`).

- [ ] Once porting is done, remove the porting map: PRD Appendix A, the old-ADR table in `docs/adr/README.md`, and the read-only references in `CLAUDE.md`.
- [ ] Rewrite the remaining mentions of the old systems as self-contained history, and check that `git grep -E 'comprobify-web|\.\./comprobify|API ADR'` finds nothing that needs them.

## After the first Terraform deploy

- [ ] Owner makes `novaej/comprobify-erp` private. It stays public until then, because GitHub's free plan limits the permissions private repositories give the Terraform plan and apply workflows.

## Open questions

See [docs/PRD.md](docs/PRD.md), section 17.
