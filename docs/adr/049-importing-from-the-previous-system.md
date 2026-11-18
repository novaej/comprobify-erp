# ADR-049: Importing from the previous system

## Status
Accepted

## Date
2026-11-18

## Context

Milestone 10 moves the data off the previous system (an API and a web app, each with its own database) before both are shut down, and its gate needs the migrated copy to reconcile on counts, sequentials and XML hashes (PRD section 15). PRD section 10 lists what comes over: tenants, issuers (as branches and issue points), certificates, sequentials that **continue exactly**, authorized documents and their XML as read-only history with their access keys still resolving, clients and products. The owner's company gets a complimentary subscription, migrated documents use no quota, and the old `sandbox` data goes to the test twin or is dropped.

What the production data holds, read from its final dumps: one company (the operator's), one issuer (001-001, facturas only), two authorized facturas (35 and 36, the earlier ones predate the system) with the sequential at 36, one client, one product, one template, and five web accounts. One is the old platform account (`support@comprobify.com`), one the owner, three people who signed up and never made a company.

The old servers and databases are destroyed before the new production exists. So the import reads **restored copies of the final dumps**, not the live systems.

## Decision

**One operator command, `pnpm import:legacy`, for one company at a time.** The worker script reads both restored databases (read-only sessions) into a plain `LegacyExport` and passes it to core's `importLegacyCompany`. Core never connects to the old databases. The script then runs `reconcileLegacyImport` and prints both results.

**The whole run is one transaction, a dry run unless `--commit`.** `inOneTransaction` (`packages/db`) holds one connection in one transaction. Each `withTenant`, `withSystem` or `withUser` inside it becomes a savepoint carrying only that call's settings, with the caller's restored afterwards. Core's workflows therefore compose unchanged, and any refusal or failure rolls back everything: accounts, company, documents. Without `--commit` the result is printed and rolled back. With it, a failed reconciliation check also rolls back. It writes as the app role (`DATABASE_URL`) with the boot guard checked, so RLS applies as in the app.

**Through core's own workflows, not table copies.**
- Each account comes in through `importAccount`.
- The company comes through `createOrganization`, the onboarding function, so its twin, branch, issue point, warehouse, membership mirror, certificate, logo, audit and default subscription are exactly what onboarding makes. `firstInvoiceNumber` is the old sequential plus one.
- Then `updateCompanyProfile` and `setIdleTimeout` for the rest of the tax data and the idle timeout.
- The plan: `changePlan` to Enterprise and `setBilling` complimentary, as the super admin.
- Then `goLive`, and the master data: `createProduct`, `createClient` and `saveTemplate`.
- Finally `recordPayment`. A new audit action, `organization.imported`, records the import with its counts (migration 0077).

**Documents are rebuilt from their authorized XML** (`importDocument` in `documents`, `readFactura` in `sri`):
- The lines, IVA per line, totals, buyer and payments are read from the XML itself, so the RIDE, the reports and the row agree with what SRI holds. The signed and authorized XML are stored byte for byte.
- A row whose authorized copy the previous system didn't keep takes its signed XML, which is what SRI authorized.
- No quota is consumed (quota is spent only by `createInvoice`), no stock is touched and no send job is queued.
- The old timeline comes over in the new event types: CREATED, STATUS_CHANGED, EMAILED, VOIDED. Delivery reports have no place in it and are counted as left out.
- SRI's calls become `sri_exchanges` with source `sri` and no timing.

**Imported invoices are recorded as collected on their issue date** (one receivable payment each, reference "Sistema anterior"). The previous system had no collections, and its invoices were settled outside it. Left open, they would show as owed in the aging report. `--leave-unpaid` keeps them open.

**Accounts.**
- The old platform flags are not carried. `--super-admin <email>` names the one account that gets it: the owner, who also invoices as the company (ADR-010 allows both). `--leave-out` drops accounts: `support@comprobify.com`.
- Old bcrypt passwords keep working: Better Auth's password check accepts a bcrypt hash beside its own, and the next password change stores the new format.
- The owner starts verified. Accounts that never made a company verify their address at their first sign-in.

**What it refuses, before writing anything that matters:**
- more than one active issuer;
- a document type other than factura;
- a document still waiting for SRI ("let them finish before the dump");
- a document numbered past its sequential;
- a member other than the owner;
- a certificate that doesn't decrypt, doesn't match its key or the RUC, or is expired;
- a company or email already present.

Those cases are not in the data; supporting them is work for whenever they are. A client, product or template that fails today's validation is left out and listed, not fatal: the operator reads it in the report. Sandbox data is not imported.

**Reconciliation**, read back from the database:
- the document count per status and the sum of totals;
- for every document: found by its access key, the signed and authorized XML's SHA-256, the authorization number;
- the last sequential per issue point and type;
- the certificate's fingerprint;
- the clients (at least the saved ones), products, templates and accounts.

The procedure, from the dumps to the check in the app, is `docs/guides/legacy-import.md`.

## Consequences

### Positive

- The imported company is indistinguishable from one onboarded here, since the same functions made it. A rule added to onboarding later applies to the import too.
- The previous key is read once, from the environment, and the certificate is stored under this system's key (PRD 9.3). It never touches disk or an argument.
- A dry run is free and repeatable: rehearse on staging until the report is clean, then run the same command on production.
- The test proves the rollback: a refusal halfway leaves no account or company behind.

### Negative

- It handles exactly the shape of the data that exists: one issue point, facturas, owner only. Another company from the old system would need the refusals turned into support first.
- A bcrypt hash stays until the owner changes the password. bcrypt at cost 12 is still acceptable; Better Auth's own scheme is the default for everything new.
- The previous timestamps of SRI calls are kept but not their durations (0 ms).
- `inOneTransaction` holds one connection for the whole run. That's right for a one-off operator job and wrong for anything the app does.

### Alternatives considered

- **Copying tables with SQL.** It's faster to write, but it would have to restate every invariant onboarding and go-live keep (twin, mirrors, defaults, audit), and it would silently skip any added later.
- **Reading the live old systems.** They are destroyed before the new production exists. The dumps are the source of record either way.
- **A fresh password for everyone.** It's simpler, but people's logins would stop working with no warning, for no security gain.
- **Leaving imported invoices unpaid.** That would be the literal reading, but it shows money owed that was collected long ago.
