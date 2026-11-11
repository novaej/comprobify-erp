# Retention periods

What the system keeps and for how long. The code reads each period from one place, `RETENTION` in `packages/core/src/kernel/retention.ts`; this table is what the legal texts must say once they are updated after the MVP (see `NEXT_STEPS.md`). The periods marked *to confirm* wait for the accountant.

| What | Kept | Pruned by | Notes |
|---|---|---|---|
| The document, its signed and authorized XML, the authorization number and date | The tax period (7 years, per the Reglamento de Comprobantes de Venta, art. 41; *to confirm*) | Not pruned | The legally required record |
| A document's timeline and one summary row per SRI exchange (call, outcome, messages) | The tax period | Not pruned | ADR-038 |
| The raw copy of SRI's answer (`sri_exchanges.raw`) | 90 days (`RETENTION.sriRawDays`) | `retention.prune`, nightly: clears the column, keeps the row | A technical duplicate, used only for support |
| The company's activity log | The tax period | Not pruned | |
| In-app notifications | 180 days | Not built yet | Needs its own narrow exception |
| Payment proofs | With the payment history | Not pruned | A company removing one only hides it from its own view |
| Technical logs with IP addresses | 3 days | The log host | Open question 2 in `review-notes.md` |
| Mailgun's delivery records | Mailgun's own policy | Mailgun | |
