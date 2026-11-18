<!--
Title: `type: description` (feat, fix, docs, refactor, test, chore, ci). It becomes the squash commit on main.
Delete the sections and checklist lines that don't apply.
-->

## Why

<!-- The problem or requirement, in a sentence or two. Requirement ids: FR-…, NFR-…, ADR-…. -->

## What changes

<!-- The changes a reviewer should know about, and any decision made along the way (with its ADR). -->

## How it was checked

<!-- Tests added or run, what was tried by hand, and where (local, staging). -->

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`
- [ ] `pnpm test:integration` (database, RLS, jobs)
- [ ] `pnpm test:e2e` (screens and flows)

## Screens

<!-- For UI changes: before and after, desktop and phone, light and dark. -->

## Checklist

- [ ] Docs updated in this PR: CHANGELOG, NEXT_STEPS (finished steps removed), ADRs, CLAUDE.md key files, QA script (`docs/guides/documentation-checklist.md`)
- [ ] Business logic in `packages/core`, permissions checked there, inputs and outputs as Zod schemas
- [ ] New tenant tables have `tenant_id` and forced RLS (`app_enable_tenant_rls()`); no hard deletes
- [ ] Migrations are forward-only, set `lock_timeout`, and leave the schema usable by the code before them
- [ ] Status CHECKs and triggers generated from their TypeScript definition
- [ ] Every UI string in `apps/web/messages` (es and en); screens built from the shared blocks
- [ ] Money and quantities in decimals; dates through `ecuador-time.ts`
- [ ] Logs list their fields; no headers, tokens, query strings or P12 data
- [ ] SRI documents: XSD before signing, element order, no retry of a clean SRI answer

## Deploying

<!-- Anything beyond merging: a new env variable or secret, a Terraform change (read its plan above), a data step, a note for the release. "Nothing" is a fine answer. -->

## Rollback

<!-- How to undo it once merged and released: revert and release, or what else. Migrations don't go back. -->
