# ADR-039: Numbering, set where it is used

## Status

Accepted

## Date

2026-11-13

## Context

FR-ONB-5 lets a company coming from another provider give the starting number of each issue point at go-live. Owners asked to set it earlier and more than once, as the previous system allowed: a migrating business knows its last number from day one, and a wrong first guess should not need support. The test copy and the real company have separate counters (SRI rule 9; the twin counts its test documents from 1), so a screen must say which one it changes.

## Decision

Numbering can be given in three places, and a number only ever moves **forward**:

- **Onboarding:** an optional "next invoice number" for the first issue point, in the advanced block. It sets the **real** company's counter; the test copy starts at 1.
- **Empresa:** a numbering card for the company in use. In Pruebas it lists and edits the **test copy's** counters ("Numeración de pruebas"); in Producción, the **real company's** ("Numeración de producción"). Owner and Admin, like the other settings.
- **Go-live:** unchanged, for the real company. Its form shows the real counters as they are now, so a number set earlier is kept.

Every path goes through `setStartingSequentials`: an unchanged number is a no-op, and a lower one fails with `SEQUENCE_BACKWARD`, because a lower counter would issue a number already given to SRI. Changes are recorded in the activity log.

## Consequences

- No new tables or grants: the counter is the existing `document_sequences.next_value`.
- A migrating owner who wants the real number before going live sets it at onboarding or at go-live; once in Producción, from Empresa.
- Skipping numbers by moving forward after issuing is allowed: a gap is harmless to SRI, a repeat is not.
- Moving a counter back, if it were ever needed, is a support action, not a screen.

## Alternatives considered

- Only at go-live (the PRD's text): rejected, the previous system allowed it earlier and a migrating owner should not need to wait.
- Editing the real company's counters from the test copy: rejected, it hides which counter a screen changes; what is shown follows the mode in use.
