# Next Steps

Open work only. Tick steps as they land. When a milestone's gate passes, remove its section: `CHANGELOG.md` and git keep the history. Requirements and gates are in [docs/PRD.md](docs/PRD.md), section 15.

## Current: Milestone 2, Entitlements and plans

**Gate:** toggling a feature per tenant changes UI and core behaviour.

The model is in [ADR-011](docs/adr/011-plans-modules-and-entitlements.md): feature keys in code, modules and plans as data, subscriptions with items, overrides, twins mirrored. Prices wait for Milestone 8.

- [x] 1. Catalog: the feature key registry in a new `entitlements` module, synced to `features` by the migrate step; platform tables `modules`, `module_features`, `plans`, `plan_modules` and `plan_limits`, with status CHECKs generated from TypeScript; the starting modules and plans seeded once (FR-PLAN-1, FR-PLAN-2).
- [x] 2. Subscriptions: `subscriptions` (plan, `PAID` or `COMPLIMENTARY` with a reason, Personalizado's negotiated price), `subscription_items` and `tenant_feature_overrides`, under forced RLS and mirrored into the twin; new companies start on Gratis, and existing ones are moved onto it (FR-PLAN-1a, FR-PLAN-1b, FR-ONB-6a).
- [x] 3. Resolver and enforcement: entitlements resolved once per request into the actor context, with the dated rule for removed modules; `requireFeature` and `requireWithinLimit` in the kernel (`FEATURE_NOT_ENABLED`, `LIMIT_REACHED`); applied to what exists today: `USERS` on invitations and `RIDE_LOGO` on the logo (FR-PLAN-3, FR-PLAN-4, FR-USR-1).
- [x] 4. UI gating: navigation and pages hide or lock what the company doesn't have; a plan page showing the plan, modules, limits and usage (FR-PLAN-4).
- [ ] 5. Super admin area: its own route group and layout with no tenant, `PlatformActor` checks in core; editors for plans and modules (contents, status); per company: plan, add-ons, Personalizado, complimentary and overrides, each recorded in the activity log (FR-ADM-1, FR-ADM-3, ADR-010).
- [ ] 6. Gate and close: E2E where switching a feature for one company changes its screens and core refuses it; isolation sweep covering the new tables; docs.

## Carried forward from Milestone 1

- **Milestone 3:** organization settings with contribuyente especial, agente de retención and RIMPE (onboarding collects only the accounting flag) and certificate renewal (FR-ONB-3); twin reset; starting sequentials asked at go-live, before the first real document; issue-point restrictions applied as query filters once documents exist (FR-ROLE-2: the actor already carries them).
- **Milestones 5 and 6:** go-live offers to copy master data from the twin (FR-ONB-5) once products, clients and suppliers exist.
- **Not scheduled:** ownership transfer (PRD section 3). Today nobody can change or remove the owner.

## Upcoming milestones

- [ ] 3. SRI engine: factura
- [ ] 4. Other SRI documents
- [ ] 5. Inventory and purchasing
- [ ] 6. Sales
- [ ] 7. Bulk invoicing
- [ ] 8. Billing
- [ ] 9. Notifications, reports, admin
- [ ] 10. Production readiness and cutover
- [ ] 11+. Post-MVP: public API, API keys, webhooks, MCP, OAuth, developer docs

## Before agreements are switched on

- [ ] Owner, or a lawyer, approves the legal texts and answers the open questions in [docs/legal/review-notes.md](docs/legal/review-notes.md); then set `AGREEMENTS_ENABLED=true` and the operator details.

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
- [ ] Refuse a TOTP code that was already used in its 30-second window. Better Auth accepts it twice; the integration tests show it (NIST SP 800-63B §5.1.4.2).
- [ ] A documented, tested rotation procedure for `CERT_ENCRYPTION_KEY` (PRD 9.3). Stored keys carry a `v1:` prefix for it.

## Before the old repositories are deleted

The owner will delete `comprobify` and `comprobify-web`, so this repo must not depend on them (`CLAUDE.md`).

- [ ] Once porting is done, remove the porting map: PRD Appendix A, the old-ADR table in `docs/adr/README.md`, and the read-only references in `CLAUDE.md`.
- [ ] Rewrite the remaining mentions of the old systems as self-contained history, and check that `git grep -E 'comprobify-web|\.\./comprobify|API ADR'` finds nothing that needs them.

## After the first Terraform deploy

- [ ] Owner makes `novaej/comprobify-erp` private. It stays public until then, because GitHub's free plan limits the permissions private repositories give the Terraform plan and apply workflows.

## Open questions

See [docs/PRD.md](docs/PRD.md), section 17.
