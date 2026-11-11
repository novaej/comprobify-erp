# ADR-037: Email Templates in the Database

## Status
Accepted

## Date
2026-11-10

## Context

FR-NOT-3 and FR-ADM-4 ask for email templates the super admin edits, versioned per language, with a fallback. Until now every account and notice email was text in code, so a wording change was a deploy.

The owner settled the design before building:

- **Structured copy, fixed layout.** The operator writes subject, heading, body, button text and footer. The HTML layout stays in code, so a text can't break an email.
- **Scope is account and notice emails.** The buyer's document copy and the purchase-order email stay in code.
- **The test send goes only to the signed-in super admin's own address.**
- **Every email leaves through one path,** so overrides such as `EMAIL_REDIRECT_TO` always apply.

## Decision

**`email_templates`** is a platform table (writes only in system context, `app_protect_platform_table`), versioned like prices: one row per (template, locale, version), `DRAFT` to `PUBLISHED` or `DISCARDED`, at most one draft per (template, locale) through a partial unique index, version numbers never reused. A trigger freezes a row once it leaves `DRAFT`; the status CHECK and transition trigger come from the TypeScript definition (rule 17). Going back to an old version means using it as a draft and publishing it: a new version.

**Placeholders are checked on save and publish.** Each template declares the fields it may use and the ones it must use (`TEMPLATE_PLACEHOLDERS`); an unknown or missing field is refused with `EMAIL_TEMPLATE_PLACEHOLDER_UNKNOWN` or `_MISSING`.

**Fallback.** `loadCopy` takes the latest published version in the recipient's language, then Spanish, then the copy in code (`DEFAULT_COPY`). `syncEmailTemplates` seeds version 1 from `DEFAULT_COPY` in the migrate step, so a fresh database starts equal to the code and no email depends on the table being filled.

**One path out.** Web and core only enqueue `email.send`. The handler is the only sender and takes the provider built in `apps/worker/src/index.ts`, wrapped by `withRedirect` and `withTestBanner`. An ESLint rule (`no-restricted-imports`) forbids importing the provider builders anywhere else. The test send goes through `email.send` too, with the screen's copy inline and a `[Test]` or `[Prueba]` subject prefix, so the redirect applies to it.

**Platform area.** `/admin/emails` lists templates by language with the version in use; the editor has save draft, preview (the email as sent, in a script-less sandboxed iframe), a test to oneself, publish, discard and the history. Every step is in the platform activity log (`email_template.drafted`, `published`, `discarded`, `test_sent`).

## Consequences

- Wording changes need no deploy, and each is attributable and reversible.
- A template added in code appears in the table after the next migrate step.
- Queued jobs resolve the copy when sent, so a publish affects emails not yet sent.
