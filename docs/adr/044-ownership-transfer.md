# ADR-044: Ownership transfer

## Status

Accepted.

## Date

2026-11-18

## Context

Every company has one owner (PRD section 3): the only role that takes it live, accepts the agreements and transfers it, the last named in the roles table ("Admin: everything except ownership transfer and promotion"). Until now nothing could change the owner: `changeRole` and `removeMember` refuse to touch them (`OWNER_PROTECTED`), so a company whose owner leaves had no way out. The PRD names the transfer but says nothing about how it works.

## Decision

- **The owner starts it, for an active member.** Any active member of the company may receive it, whatever their role. Someone outside the company is invited first, so they have already accepted to be in it.
- **Immediate, with a typed confirmation.** The owner types the new owner's email. There is no acceptance step: the receiver is already a member who can see the company, and a pending transfer would leave two people half-owning it.
- **The old owner becomes an admin.** They keep their access and can leave or be removed later. One owner at a time stays true.
- **Both companies of the pair together.** As every membership change (ADR-010), it is written to the real company and its test copy in one transaction. The new owner's issue-point restriction is cleared, since an owner sees every point (FR-ROLE-2).
- **Logged.** `member.ownership_transferred`, with the new owner as the subject, in the ACCOUNT category (ADR-041).
- **Where:** a crown button beside each other member on Usuarios, shown to the owner only. Core checks `organization.transfer_ownership`.

## Consequences

- A company whose owner is gone for good, with no way to sign in, still needs the platform's support. A super admin transfer (with proof of who asks) is not built.
- The new owner gets no email. The change shows on their next page load, and in the activity log.
- Billing contacts follow the roles (owners and admins), so they don't change.

## Alternatives considered

- **The receiver accepts it, from an email link.** Rejected for now: more moving parts (a token, an expiry, a pending state) for a step between two people who already work together. It can be added in front of the same core function.
- **Two owners.** Rejected: the PRD has one, and go-live and the agreements need a single person answerable for them.
