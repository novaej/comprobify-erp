# ADR-015: The RIDE and the Buyer's Copy

## Status
Accepted

## Date
2026-11-05

## Context

The RIDE is the printed form of an electronic document; SRI's Ficha Técnica defines what it shows. A buyer gets it by email with the XML when the document is authorized (FR-DOC-10, FR-DOC-11).

The old system's RIDE had four problems:

- **It drifted.** Built from live data, the RIDE of an old invoice changed after builder fixes. The fix was to build it from the authorized XML.
- **It recomputed the totals with floats.** Its totals box could disagree, by a cent, with what SRI authorized.
- **It had no page breaks.** A long invoice ran off the page.
- **It printed the authorization time in the server's time zone.** The servers run on UTC.

It also left out the legends the Ficha requires on the RIDE: agente de retención (Anexo 21) and RIMPE (Anexo 22).

## Decision

**Everything on the RIDE comes from the authorized XML** (SRI rule 15).

- `rideData` reads it with xmldom and keeps every value the string SRI authorized: line totals, `totalConImpuestos`, the total and the payments. Nothing is recomputed.
- The totals box follows SRI's order and keeps 0%, no objeto de IVA and exento as separate lines.
- The only live input is the logo, printed while the plan has `RIDE_LOGO`.
- The authorization number and time come from SRI's answer, and the time prints in Quito time.

**pdfkit and bwip-js.** These are what the old system used, now on their current versions:

- The page is A4.
- The access key is a Code 128 barcode.
- The item table moves onto a new page when it's full, repeating its header, and the totals box moves to a new page if it doesn't fit.
- In the web build, pdfkit stays a Node package (`serverExternalPackages`, and a dependency of `apps/web`), because it reads its font files from its own folder.

**The RIDE's texts are code, in Spanish.** Its labels and the Ficha's catalogue descriptions (Tablas 6 and 24) are fixed parts of SRI's format, not UI strings, so they sit in `sri/ride-labels.ts` rather than the message files.

**The XML attached and downloaded is SRI's `<autorizacion>`.** It holds the state, the number, the time and the authorized document as CDATA. This is the form buyers' accounting systems import.

**The buyer's copy is a job, enqueued with the authorization.** `documents.email` is enqueued in the same transaction that makes a document `AUTHORIZED`. It sends the RIDE and XML through the email provider, from "`<legal name>` via Comprobify" at the platform's address, and writes an `EMAILED` event. Its rules:

- It sends once. A person can resend.
- It needs `BUYER_EMAIL` on the plan and an email on the buyer. Consumidor final has none.
- It carries Mailgun custom variables (`document-id`, `tenant-id`), so the delivery webhook can match its events to the document once the owner turns it on.

**The test twin emails too, marked as a test.** A document in SRI's test environment (ambiente 1) sends the same email, with `[PRUEBAS]` in the subject and a line saying it has no tax validity. A company can then see its buyers' email before going live, and nobody mistakes it for a real invoice.

**Senders, the test recipient and the off switch.** These carry over the old system's settings:

- **Two senders.** Buyers' copies come from `EMAIL_FROM_DOCUMENTS`, falling back to `EMAIL_FROM`; account emails come from `EMAIL_FROM`.
- **The test recipient.** `EMAIL_REDIRECT_TO` sends every email to one address instead. The subject gets `[REDIRIGIDO]`, and a note at the top names who the email was for. It's for a restored copy of real data, where it keeps real buyers from getting emails (CLAUDE.md mistake 13). Unlike the old system, which only warned, the env refuses it in production, so a leftover setting can't divert real invoices.
- **The staging banner.** On `APP_ENV=staging` every email opens with a banner saying it comes from a test system.
- **The off switch.** `EMAIL_PROVIDER=none` sends nothing. The provider reports what happened (`sent`, `logged`, `skipped`), so a skipped buyer's copy gets no `EMAILED` event, and the timeline never claims an email that didn't go out. `log` writes emails to the log and is allowed locally only, since links carry tokens.

## Consequences

### Positive

- An old RIDE never changes. It always matches what SRI authorized, to the cent.
- Long documents print correctly.
- The buyer's copy can't go out for a document that was never authorized, because it's part of the same commit.

### Negative

- **Retries can resend.** A retry after a send whose event failed to commit sends twice. That's harmless for an informational email.
- **The test twin reaches real buyers.** That's on purpose, and the email is labelled. If companies object, the option is to send the twin's copies to the company's own users only.
- **The RIDE has no translation:** SRI's format is Spanish.

### Alternatives considered

- **Rendering from the stored rows:** rejected. That's exactly how the old RIDE drifted.
- **An HTML-to-PDF browser (Chromium):** heavy for a server image, and slower than drawing the page. Rejected.
- **Sending the buyer's copy through `email.send`:** its payload goes into the job table, and a PDF doesn't belong there. The new job builds the files when it runs.
