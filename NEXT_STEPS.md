# Next Steps

Open work only. Tick steps as they land. When a milestone's gate passes, remove its section: `CHANGELOG.md` and git keep the history. Requirements and gates are in [docs/PRD.md](docs/PRD.md), section 15.

## Current: Milestone 1, Identity and tenancy

**Gate:** two tenants and a tenant/twin pair fully isolated (integration); the ambiente rule covered for every deployment × mode cell; invite and role restrictions (E2E).

Before starting: decide the auth library (PRD open question 7) in an ADR, and read API ADRs 018 and 035 ([docs/adr/README.md](docs/adr/README.md)). Break the scope into steps here.

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

## Before the first push

- [ ] Owner makes `novaej/comprobify-erp` private. It's currently public.

## Open questions

See [docs/PRD.md](docs/PRD.md), section 17.
