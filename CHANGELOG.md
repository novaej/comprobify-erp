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
