# Documentation Checklist

A change isn't done until its docs are. Update these in the same piece of work.

| Change | Update |
|---|---|
| Any user-visible or operator-visible change | `CHANGELOG.md` under Unreleased |
| Finishing a step in `NEXT_STEPS.md` | Tick it. Remove the milestone's section when its gate passes. |
| New or changed env variable | The schema in `packages/config/src/env.ts`, `.env.example`, `docs/deployment.md`, `infra/compose.yaml` if the stack needs it |
| New command or script | `CLAUDE.md` commands, `GETTING_STARTED.md` if developers run it |
| New package, app or top-level folder | `CLAUDE.md` architecture, `docs/architecture.md` |
| A decision between real alternatives, or a pattern others will copy | A new ADR, and the index in `docs/adr/README.md` |
| Something that went wrong and could again | `CLAUDE.md` common mistakes |
| New table | Drizzle schema, migration, `docs/architecture.md` if it adds a concept |
| New job or schedule | The registry, `docs/architecture.md` if it adds a flow |
| New UI string | Both message files |
| New key file | `CLAUDE.md` key files |
| Deploy, infra or Docker change | `docs/deployment.md` |
| SRI behaviour | `docs/domain/sri.md` (from Milestone 3) |
