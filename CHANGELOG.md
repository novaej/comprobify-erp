# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- pnpm workspace with Turborepo, strict TypeScript, ESLint and Prettier.
- Lint rules for the core module boundaries (NFR-ARCH-1, NFR-ARCH-4, NFR-ARCH-5).
- `CLAUDE.md`, the stack ADRs and the first setup docs.
- Env validation per process, with `.env.example` kept in sync by a test.
- Allow-listed JSON logger with optional Betterstack shipping.
- Core kernel: actor context, `DomainError` and `Clock`.
- `pnpm db:setup`, `db:migrate` and `db:generate`, with separate owner and app roles (NFR-SEC-4).
- Fail-loud RLS functions and `app_enable_tenant_rls()` in the first migration (NFR-SEC-1).
- `createDatabase`, with `withTenant`, `withSystem` and a boot guard (NFR-SEC-2, NFR-SEC-4).
- RLS isolation and catalog integration tests on probe tables (NFR-SEC-5).
- pg-boss in its own schema, with a queue registry, transactional `enqueue` and schedules in Ecuador time (NFR-JOB-1, NFR-JOB-2, NFR-JOB-3).
- Worker app with the boot guard and a `system.heartbeat` job.
- `packages/ui` with the design system ported from `comprobify-web`, and a theme script that prevents the flash of the wrong theme.
- Web app: localized home, error and not-found pages in Spanish and English, `/health`, request ids and Sentry.
- One Docker image for web, worker and migrate, and a local Compose stack with Caddy.
- CI: lint, types, unit and integration tests, image build, dependency audit, and an E2E smoke test on `main`.
- `LOG_FORMAT` (`json` or `pretty`).
- Architecture, coding, testing, documentation and deployment docs.
- Accounts with Better Auth: sign-up, email verification (the link's `GET` never consumes it), sign-in, sign-out, sign out everywhere and password reset (FR-ONB-1, FR-ONB-7, FR-USR-2).
- Database sessions with a 30-minute idle timeout that only real activity extends, and a 7-day absolute lifetime (FR-USR-2).
- Rate limits per abuse vector, stored in Postgres (FR-USR-4).
- `email.send` job with Mailgun, logged instead of sent locally; daily `identity.prune` job.
- Tenancy model: organizations with their test twin, branches, issue points, warehouses and mirrored memberships, all under RLS (FR-ONB-4, FR-ONB-6a, NFR-SEC-1).
- A user context for identity lookups, and the organization switcher's checks (FR-USR-5, ADR-010).
- Roles and permissions in core, with the database CHECK generated from the same list (FR-ROLE-1).
- The ambiente rule for every deployment × mode cell (FR-ONB-6).
- Onboarding: RUC structure check, any CA's P12, the certificate checked against the RUC, the private key encrypted with AES-256-GCM, certificate and logo stored on the organization and its twin, and the user starting in the twin (FR-ONB-2 to FR-ONB-4).
- `CERT_ENCRYPTION_KEY`, and `pnpm test-certificate` for local testing.
- Forms keep what was typed after an error.
- The app shell: sidebar layout with the organization switcher and its Producción / Pruebas toggle (production only after go-live), the sandbox banner, the certificate banner at 30 days and on expiry, a skip link, and a mobile drawer (FR-USR-5, FR-UX-2).
- A dashboard placeholder; signing in and onboarding land there.
- Users page: invitations by email (the link's `GET` never uses it up), role changes, soft removal and issue-point restrictions, each applied to the organization and its twin. New users set their password on the invitation and start verified (FR-USR-1, FR-ROLE-1 to FR-ROLE-3).
- Two-step verification with an authenticator app (TOTP) and single-use backup codes, set up and turned off from the account page; an organization can require it of every member (FR-USR-3).
- The company activity log: append-only, recording organization, certificate and member changes, the two-step requirement, go-live and sign-ins, readable by Owner, Admin and Accountant (FR-NOT-4).
- Go-live: the Owner takes the real company to production, one way, from a page that explains what changes (FR-ONB-5).
- Legal documents: the Terms, Privacy Policy and DPA as versioned texts published from the repo by the migrate step, a personalized copy per company, and acceptance by the Owner recorded with its copy, IP address and browser. Off (`AGREEMENTS_ENABLED=false`) until the owner approves the texts; when on, go-live requires them (FR-ONB-8).
- `AGREEMENTS_ENABLED`, `OPERATOR_NAME`, `OPERATOR_RUC`, `OPERATOR_ADDRESS` and `SUPPORT_EMAIL`.
- An isolation sweep: every tenant table, found from the database catalog, holds rows for two companies and a twin, and none sees another's (Milestone 1 gate, NFR-SEC-1).
- The plan catalog: feature keys in code, and modules and plans as platform data that only system context can write, with the starting catalog seeded once by the migrate step (FR-PLAN-1, FR-PLAN-2, ADR-011).
- Subscriptions: each company and its twin hold a plan, paid or complimentary, with add-on modules, Personalizado's limits and price, and per-company overrides, all under RLS. New companies start on Gratis, and the migrate step puts existing ones on it (FR-PLAN-1a, FR-PLAN-1b, FR-ONB-6a).
- Entitlements resolved once per request into the actor context, with `requireFeature` and `requireWithinLimit` in the kernel. Invitations respect the plan's users, counting pending invitations, and accepting rechecks it; the logo is used on documents only with the Marca module (FR-PLAN-3, FR-PLAN-4, FR-USR-1).
- The plan page: the company's plan, its modules (coming soon, add-ons, dated removals) and each limit with its usage. Menu items and pages can be hidden or locked by feature, and the users page says when the plan has no seats left (FR-PLAN-4).
- The platform area at `/admin`, for super admins with two-step verification: every company with its plan, and per company the plan, add-on modules (removed at the next month), Personalizado's limits and negotiated price, complimentary with a reason, and overrides, each mirrored in the twin and recorded in the company's activity log (FR-ADM-1, FR-PLAN-1a, FR-PLAN-1b, ADR-010).
- `pnpm super-admin <email>` to set the flag.
- `AUTH_SECRET`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION` and `EMAIL_FROM`.
