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
