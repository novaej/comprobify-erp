# ADR-052: Rotating the certificate key

## Status
Accepted

## Date
2026-11-23

## Context

Each company's certificate private key is stored encrypted with `CERT_ENCRYPTION_KEY`, AES-256-GCM, in `certificates.encrypted_private_key`, for the company and its test copy (FR-ONB-3). PRD 9.3 asks for a documented, tested rotation. The stored values carried a `v1:` prefix for it, but the cipher held one key, so changing it would have made every stored certificate unreadable, and every invoice unsignable, until each company uploaded its P12 again.

## Decision

**A value names the key that wrote it.** New values are `v2:<key id>:<iv>:<tag>:<ciphertext>`, the id being the first 8 hex characters of the key's SHA-256. The id identifies a key without revealing it, and lets a report say which key holds what. `v1:` values, from before ids, carry none. They are read by trying each configured key, which is safe because GCM's tag rejects a wrong key.

**Two keys during a rotation.** `CERT_ENCRYPTION_KEY` is the current key: it writes, and it reads. The optional `CERT_ENCRYPTION_KEY_PREVIOUS` is only read. A value under a key that is neither fails with its id named ("Encrypted with key 1a2b3c4d, which is not configured"), so a missing previous key is obvious. The previous key may not equal the current one.

**Re-encryption is one operator command,** `rotate-cert-key` (`pnpm rotate:cert-key` locally; in the worker's image on a droplet):
- It runs `rotateCertificateKeys` (`tenancy/certificate-keys.ts`) in system context over every company and test copy, active certificates or not.
- It opens every value not under the current key and writes it again under that key.
- It's a dry run unless `--commit`, and one transaction, so a value no key opens rolls it all back.
- Running it again changes nothing.

**The procedure** (`docs/guides/certificate-key-rotation.md`):
1. new key current, old key previous, deploy;
2. dry run, then commit;
3. drop the previous key, deploy.

At no step is a certificate unreadable: before step 2 both keys read, and after it the current key holds everything.

## Consequences

### Positive

- The key can be changed at any time, for a suspected leak or once a year, without companies re-uploading their certificates and without a pause in signing.
- The report says, per key id, what each key still holds, so a forgotten value shows before the old key goes.

### Negative

- Two deploys per rotation: one to add the new key, one to drop the old.
- A backup taken before step 2 needs the old key to restore its certificates. The guide says so, and the restore drill covers it.
- `v1` values stay readable only by trial, with no id in their report line, until one run rewrites them.

### Alternatives considered

- **A list of previous keys.** It's more flexible, but rotations are sequential, and one finishes (step 3) before the next starts, so one previous key is enough.
- **Keeping only the version prefix** and trying every key for every value. It works, but nothing could then say which values are still under the old key.
- **Re-encrypting on read**, as certificates are used. Certificates of companies that rarely issue would keep the old key indefinitely, so the old key could never be dropped.
