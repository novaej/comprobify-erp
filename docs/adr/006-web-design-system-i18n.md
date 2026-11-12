# ADR-006: Next.js, Ported Design System, next-intl

## Status
Accepted

## Date
2026-11-01

## Context

The ERP must keep the look and feel of `comprobify-web` (FR-UX-2), Spanish first (FR-UX-1). That app uses Next.js 16, React 19, Tailwind v4 and shadcn `base-nova`. It has 17 components in `src/components/ui`, which import only `@/lib/utils`, each other and one theme module.

## Decision

**Next.js App Router** at the versions in ADR-002. Pages load through Server Components. Mutations use server actions. TanStack Query is for polling and live views only. Request handling lives in `proxy.ts`, the Next.js 16 convention.

**`packages/ui` holds the design system:** the tokens from `globals.css`, all 17 components, `cn()`, the theme provider and sonner setup. Imports move from `@/…` to package-relative paths, and `components.json` points at the package so `shadcn add` keeps working. Components are otherwise ported as they are.

**Ported in Milestone 0:** theme tokens, light and dark, the status palettes, sidebar and panel tokens, field-border and switch contrast fixes, and the stacked-table rules.

**Ported later, with their screens:** the marketing decoration and hero animations (FR-UX-5), plus `nav.tsx`, status badges, banners and the notification bell. These depend on auth or document state, which don't exist yet.

**Fonts:** Geist and Geist Mono through `next/font`, as today. Bricolage Grotesque (`font-display`) arrived with the marketing pages.

**Theme switching: the previous web app's own shim** (now in `packages/ui/src/theme`), not `next-themes`. That library's injected script triggers a React 19 warning, so the old app replaced it. The shim keeps the same public API and prevents the flash of the wrong theme through a `beforeInteractive` script in the root layout. Found while porting: the old app describes that script but never shipped it, so it is new here. The shim also reads its state through `useSyncExternalStore`, because React 19's hooks lint rejects copying it into state inside an effect.

**i18n: next-intl,** `es` default, `en` secondary, `localePrefix: 'always'`, matching the old routing so URLs stay familiar. Message files live in `apps/web/messages/`. Milestone 0 ports only the namespaces it renders (`common`, `errorBoundary`, `notFoundPage`). Later milestones port keys alongside each screen, reusing the old keys where screens match.

**The empty app** is one localized page using real tokens and components, in light and dark, plus error and not-found pages. No marketing or auth screens.

## Consequences

### Positive
- Visual parity comes from the same tokens, not from imitation.
- The worker and core never pull in UI code.
- Porting strings with their screens avoids 2,500 unused keys.

### Negative
- `packages/ui` needs `transpilePackages`, and Tailwind must scan it through `@source`.
- Until `nav.tsx` lands in Milestone 1 the app has no shell.
- We own the theme code instead of relying on a library.

## Alternatives considered

- **Keeping components in `apps/web`**: simpler now, but the PRD layout puts them in `packages/ui`.
- **Porting all messages at once**: leaves dead keys and hides which screens are done.
