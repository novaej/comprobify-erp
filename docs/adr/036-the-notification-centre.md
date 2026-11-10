# ADR-036: The Notification Centre

## Status
Accepted

## Date
2026-11-10

## Context

FR-NOT-1 asks for in-app notifications with read state per user, an email channel per type, and preferences per type and channel, with mandatory types that can't be muted. FR-NOT-2 lists what to notify. Until now the system had two unconnected pieces: billing emails sent straight from the daily job and a few alerts that were only logged.

The owner settled the design before building:

- **Each type decides what it can be.** A type is defined as in-app only, email only, or both, and a user can only switch on what its type allows.
- **Types are for roles.** A member is only offered the types their role can act on.
- **Preferences are per company,** not one set per user.
- **The test copy's notifications show,** marked "Pruebas".

## Decision

**The catalogue is in code** (`notifications/catalog.ts`) and typed over the names in the schema (`NOTIFICATION_TYPES`), so a type exists in one place only (rule 17). Each type declares:

- `channels`: what it can use;
- `defaults`: which are on until the member chooses;
- `mandatory`: its channels are always on, whatever the member chose;
- `audience`: the permission a member needs to receive it;
- `emailTemplate`: present exactly when it has the email channel (a test holds the catalogue to this);
- `link`: where it leads.

**Three tenant tables** (migration 0059, forced RLS):

- `notifications`: one row per event in a company. It stores the type and plain parameters, never text, so it is written when shown, in the reader's language. Always in the real company, also for what happened in its test copy, which `environment` records.
- `notification_receipts`: one row per member who sees it in the app, with `read_at`. A member with the in-app channel off gets none.
- `notification_preferences`: what a member chose, per company, type and channel. Only choices are stored, so a new type's defaults reach everyone who never touched it.

**`notify(tx, deps, input)`** is the one way to tell a company, in the caller's transaction (rule 10):

1. It takes the company's active members whose role holds the type's `audience` permission.
2. For each, it works out the channels: all of a mandatory type's, else what they chose, else the defaults.
3. It writes one notification and a receipt for each member with the in-app channel.
4. For each member with the email channel it enqueues `email.send` in that member's language, with a link back to the app.

The daily billing job, the price re-pricing notices and the operator's decision on a payment now go through it.

**What a member can do** (core functions, actor first; each touches only the member's own rows): list with paging and an unread filter, a summary for the bell, mark read and mark all read, read their preferences, set one. Setting one refuses a type their role doesn't receive, a mandatory type, and a channel the type lacks, with stable codes.

**The screens.** A bell in the top bar and in the mobile bar shows the unread count and the latest few; `/notifications` has the full list and the preferences. There is no background polling: the count is read with each page and after each change, since polling must not count as activity for the session timeout (CLAUDE.md mistake 16).

**First producers.** The renewal cycle and re-pricing notices, and two new types: `PAYMENT_VERIFIED` and `PAYMENT_REJECTED`, sent when the operator reviews a transfer and when a card payment applies. The rest of FR-NOT-2 follows in later steps.

## Consequences

- One place decides who is told, how and in what language; a new type is a catalogue entry, a message pair and, if it emails, a template.
- A viewer or a salesperson never gets billing notices, in either channel.
- Preferences multiply by company: a member of two companies sets each separately.
- Old notifications aren't removed yet. Pruning needs a narrow exception to the no-delete rule, and comes with the retention work (`NEXT_STEPS.md`).
- Notifications to the operator (a transfer reported, a card payment applied) need platform-side tables, since they belong to no company. They reuse this catalogue and come in a later step.
