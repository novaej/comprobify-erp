# ADR-050: Names without "erp"

## Status
Accepted

## Date
2026-11-18

## Context

The repository was built beside the previous system (`comprobify`, `comprobify-web`), so its names carried an `erp` to stay apart:
- the database roles `comprobify_erp_owner` and `comprobify_erp_app`, since the old API already had a `comprobify_app` role on the shared local Postgres (ADR-003, CLAUDE.md mistake 21);
- the local databases `comprobify_erp_local`, `_test` and `_e2e`;
- the droplets, the paths on them and the Terraform state keys (ADR-048).

The previous system's servers and databases are now destroyed, and its repositories will be. This one becomes `comprobify`. Its first deployed database, on staging, was created as `comprobify_staging_db` with the roles `comprobify_owner` and `comprobify_app`, and hasn't been migrated yet.

The migrations name the app role in their grants and revokes, and rule 16 says a merged migration is never edited.

## Decision

**Everything drops the `erp`:**
- the roles: `comprobify_owner`, `comprobify_app`;
- the local databases: `comprobify_local`, `comprobify_test`, `comprobify_e2e`;
- the deployed databases: `comprobify_<env>_db`;
- the droplets and their resources: `comprobify-<env>`;
- the path on the droplet: `/opt/comprobify`;
- the Compose project and the local image: `comprobify`;
- the Terraform state: `<env>/comprobify/terraform.tfstate`;
- the package name: `comprobify`.

The GitHub repository keeps its name until the old `comprobify` repository is deleted. The image name follows it on its own, through `github.repository`.

**The merged migrations that name the role are edited, once.** This is the only exception to rule 16. That rule protects databases that already ran a migration, and none outside a developer's machine has: staging is about to run them for the first time. The migrator (drizzle) records each migration by its creation time and doesn't recheck file contents. So a local database migrated under the old names stays consistent once its roles and databases are renamed in place (`ALTER ROLE … RENAME`, `ALTER DATABASE … RENAME`): grants follow the role, not its name. From staging's first migration on, the role names are fixed.

**The staging droplet is destroyed and created again** under the new names. Its state key changes, so it is destroyed under the old key first.

## Consequences

### Positive

- The names say what the system is, with nothing left over from the time two systems ran side by side.
- Staging and production start with the names they'll keep.

### Negative

- An exception to rule 16, taken while it costs nothing. It can't be taken again once a deployed database has run the migrations.
- Each developer's local `postgres18` container needs the old repository's `comprobify_*` roles and databases dropped, and this one's renamed. GETTING_STARTED.md has the commands.

### Alternatives considered

- **Keeping the `erp` role names and renaming the rest.** This would honour rule 16 literally, but leaves the system with a name it no longer has, forever, to protect databases that don't exist.
- **A role name read from a setting in the migrations.** This would be more flexible, but means rewriting every grant for a name that changes once.
