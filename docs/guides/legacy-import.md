# Importing from the previous system

How the owner's company moves from the previous system (its API and web app databases) into an environment of this one, from the final dumps to checking it in the app. The decisions are in [ADR-049](../adr/049-importing-from-the-previous-system.md). The operator runs every step: it touches real data and real secrets.

Rehearse on staging first, as often as needed. Then run the same command against production, and nothing else changes.

## What you need

- The two final dumps, taken as `doadmin` after the previous system stopped issuing: `api-backup.dump` and `web-backup.dump`.
- The previous API's `ENCRYPTION_KEY`, which encrypted the certificate's private key.
- The target environment up and migrated (`docs/deployment.md`), with:
  - its app-role database URL (`DATABASE_URL` in its `RUNTIME_ENV`);
  - its `CERT_ENCRYPTION_KEY`, the same value as in `RUNTIME_ENV`. The app must be able to decrypt the certificate the import stores, so a different key breaks signing.
- Your machine allowed to reach the target cluster: add its address to the cluster's trusted sources for the run, and remove it afterwards.

## 1. Restore the dumps locally

Into the local `postgres18` container, beside the databases this repo uses:

```bash
docker exec postgres18 createdb -U postgres legacy_api
docker exec postgres18 createdb -U postgres legacy_web
docker exec -i postgres18 pg_restore -U postgres -d legacy_api --no-owner --no-acl < api-backup.dump
docker exec -i postgres18 pg_restore -U postgres -d legacy_web --no-owner --no-acl < web-backup.dump
```

The import only reads them, in read-only sessions.

## 2. Dry run

Put the values in the environment for this one command, never in a file in the repo:

```bash
export DATABASE_URL='postgresql://comprobify_app:…@<cluster host>:25060/comprobify_staging_db?sslmode=verify-full&sslrootcert=/path/to/ca-certificate.crt'
export CERT_ENCRYPTION_KEY='<the environment's key>'
export LEGACY_API_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/legacy_api'
export LEGACY_WEB_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/legacy_web'
export LEGACY_ENCRYPTION_KEY='<the previous ENCRYPTION_KEY>'
export APP_ENV=staging

pnpm import:legacy --ruc 1715824775001 \
  --super-admin japc.93@outlook.com \
  --leave-out support@comprobify.com
```

The CA certificate is DigitalOcean's, downloaded from the cluster's page. Whether node-postgres needs it is the open TLS item in `NEXT_STEPS.md`: this run settles it.

The script prints:
- the company, its accounts, and what it brought;
- anything it left out, with the reason;
- the reconciliation, one line per check.

Then it rolls everything back: `Dry run: … nothing was kept.`

Options:
- `--plan <key>` picks another plan than `ENTERPRISE`.
- `--leave-unpaid` leaves the imported invoices open in receivables, instead of recorded as collected on their issue date.

## 3. Read the report

- Every reconciliation line must be `ok`:
  - the documents and their totals;
  - each document's signed and authorized XML hash and its authorization number;
  - `last sequential 001-001 type 01: 36`;
  - the certificate fingerprint;
  - the products, templates and accounts.
- `left out` lines name a client, product or template today's rules refuse. Decide whether to fix it in the app after the import (add the client again) or leave it.
- `Refused (…)` means nothing was written. The message says why: a document still waiting for SRI, a second issuer, a company already there, the wrong previous key.

## 4. Commit

The same command with `--commit`. Nothing is kept unless every check passes.

## 5. Check it in the app

Sign in as `japc.93@outlook.com` with the old password. As super admin you are asked to set up the two-step code.

Then check:
- **Comprobantes**: facturas 001-001-000000035 and 000000036, authorized, each opening its RIDE and XML.
- **Nueva factura**: the number offered is 001-001-000000037.
- **Plan y pagos**: Empresa, courtesy (no charge).
- **Cuentas por cobrar**: nothing owed (unless `--leave-unpaid`).
- **Actividad**: "trajo la empresa del sistema anterior".
- **Clientes**, **Productos** and the template on the invoice form.
- The platform area (Administración) opens.

Issue the next real invoice only on production, after cutover.

## 6. Afterwards

- Remove your machine's address from the cluster's trusted sources.
- Keep the dumps and the previous key, apart from each other, until production is imported and checked. Then decide how long to keep them (`docs/legal/retention.md`).
- Drop the local copies: `docker exec postgres18 dropdb -U postgres legacy_api` (and `legacy_web`).
- On staging, the imported company is real data: treat the staging cluster like production until it is deleted.
