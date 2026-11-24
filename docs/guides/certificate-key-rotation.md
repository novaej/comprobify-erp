# Rotating the certificate key

`CERT_ENCRYPTION_KEY` encrypts each company's stored certificate private key (PRD 9.3). This is how to change it, on staging or production, with no moment where a certificate can't be read and so no invoice that can't be signed. The decisions are in [ADR-052](../adr/052-certificate-key-rotation.md).

**When:** if the key may have leaked (a `RUNTIME_ENV` copied somewhere it shouldn't be, a person with access leaving), and otherwise once a year.

**What you need:** the environment's current `RUNTIME_ENV` (in your password manager), and SSH to the droplet as its deploy user.

## 1. Make the new key current, keeping the old one readable

```bash
openssl rand -hex 32   # the new key
```

In the environment's `RUNTIME_ENV`:
- `CERT_ENCRYPTION_KEY` = the **new** key;
- `CERT_ENCRYPTION_KEY_PREVIOUS` = the **old** key, the one that was `CERT_ENCRYPTION_KEY` until now.

```bash
gh secret set RUNTIME_ENV --env <staging|production> < ~/runtime.env && rm ~/runtime.env
```

Then deploy the running version again, so web and worker read the new env:
- **Staging:** `gh workflow run deploy-staging.yml`.
- **Production:** `gh workflow run production.yml --ref vX.Y.Z`, with the tag in production now.

From here on, every new certificate is stored under the new key, and the existing ones are still read with the old one.

## 2. Re-encrypt what is stored

On the droplet, with the stack's own env:

```bash
ssh -i ~/.ssh/comprobify_<env> <deploy user>@<droplet IP>
cd /opt/comprobify
docker compose run --rm worker node --import tsx src/rotate-cert-key.ts           # dry run
docker compose run --rm worker node --import tsx src/rotate-cert-key.ts --commit
```

- **The dry run** lists the stored keys by the key that wrote them and says how many would be re-encrypted, after opening every one. Nothing is written.
- **The commit** rewrites them under the new key, in one transaction: all or none.
- **Run it again:** it must say `Nothing to re-encrypt`.

If it says `Nothing was changed: Encrypted with key <id>, which is not configured`, a value was written with a key that is neither current nor previous. Stop, and find that key before going on.

## 3. Drop the old key

Remove `CERT_ENCRYPTION_KEY_PREVIOUS` from `RUNTIME_ENV`, set the secret, and deploy again as in step 1. Then check that it still signs:
- **Staging:** issue an invoice in the test copy.
- **Production:** open a document's RIDE. Signing is checked by the next real invoice, so watch Comprobantes after it.

Store the new key in the password manager in place of the old one. Destroy the old key's copies only once step 3 is deployed.

## Notes

- **Locally**, the same command runs with `pnpm rotate:cert-key [--commit]` against the database in `.env`.
- **Values from before key ids** (`v1`) show as `v1 (before key ids)` and are re-encrypted like any other. Running step 2 once with no new key, which leaves `CERT_ENCRYPTION_KEY_PREVIOUS` unset, rewrites them under the current key with its id, so later reports say which key holds what.
- **Backups** taken before step 2 hold the keys under the old key. A restore of one needs the old key as `CERT_ENCRYPTION_KEY_PREVIOUS` (or as the current key) until it is re-encrypted again.
