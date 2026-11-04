# ADR-012: Money Arithmetic and SRI Catalogues

## Status
Accepted

## Date
2026-11-04

## Context

Milestone 3 builds invoices, so it needs two foundations first.

**Money.** CLAUDE.md rule 14 forbids floats for money and quantities. The old builders computed every amount with `parseFloat` and `toFixed`, so `0.1 + 0.2` and similar errors could reach a document, and a missing field once wrote `NaN` to the database. The Ficha Técnica v2.32 (9.17) fixes the formats: amounts have at most two decimals, quantity and unit price at most six, with a dot as the separator. It doesn't say how to round.

**Catalogues.** The Ficha defines the codes a document uses: document types (Tabla 3), identification types (Tabla 6), taxes (Tabla 16), IVA rates (Tabla 17), payment methods (Tabla 24) and time units for payment terms. The old system kept them as seeded tables. Its first seed even gave IVA code `2` the 15% rate; code `2` is 12% and 15% is `4`, which a later migration had to fix.

## Decision

**Decimals through `decimal.js`.** One configured copy in the kernel, `Dec`, with 40 digits of precision and half-up rounding, the way an accountant rounds. Values enter as strings, validated by `amountInput` (up to 2 decimals) and `preciseInput` (up to 6), so a float never stands in for one. `money()` rounds to cents; `toSriAmount` and `toSriPrecise` format for the XML. The database stores them as `numeric`.

**Rounding.** The Ficha leaves it open, so:

- A line's base is quantity × unit price − discount, rounded to cents. A discount larger than the line is refused.
- A line's IVA is its base × the rate, rounded to cents.
- The document's subtotal and each tax group (by tax and rate code, as `totalConImpuestos` lists them) are the sums of the rounded line values, and the total is the subtotal plus the taxes.

So the totals always equal what the lines show, on the document and on the RIDE.

**Catalogues are code, not tables.** They live as typed lists next to the schema (`packages/db/src/schema/sri.ts`), re-exported by core's `sri` module:

- They change only when SRI publishes a new Ficha, and that needs a code change to the builders anyway.
- The builder and validation read them without a query, and unit tests cover them.
- A column holding one of these codes gets a CHECK generated from the same list (rule 17), like statuses.
- Their labels are in the message files (rule 18), and a test requires a label for every code in both languages.

**IVA rates.** All nine codes of Tabla 17 are kept, so older documents still read. Only 0%, 15%, 5%, not subject and exempt can be chosen for a product today. The historical 12% and 14%, the 13% set by decree, and the differentiated rate are kept but not offered, until the accountant says they apply (PRD section 17).

**Taxes other than IVA.** The tax codes for ICE and IRBPNR are listed, but no rates are seeded. ICE's Tabla 18 has ad valorem and specific rates that change every year; it's added when a customer needs it.

## Consequences

### Positive
- No float ever touches an amount, and the rounding is the same in every module.
- The catalogues are typed: a wrong code fails to compile, and the CHECKs match the code by construction.
- The historical IVA rate code mistake can't come back: the list is reviewed against the Ficha in one file.

### Negative
- A new catalogue value needs a release, as a new Ficha does anyway.
- `decimal.js` values must be converted at the edges (strings in, strings out); the helpers make that the easy path.

## Alternatives considered

- **`big.js`.** Smaller, but with fewer rounding modes and no `clone()` to fix one configuration for the whole codebase.
- **Integer cents.** It breaks for unit prices and quantities with up to six decimals, which the Ficha allows.
- **Catalogue tables, as before.** They add a query and a seed to keep in step with the code that uses them, for data only a release changes.
- **Rounding only the totals.** The document's totals could then differ by a cent from the sum of its lines, which accountants and buyers notice.
