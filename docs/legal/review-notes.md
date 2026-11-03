# Legal Texts: Review Notes

The Terms of Service, Privacy Policy and DPA in `packages/core/src/agreements/texts/` were ported from the previous product, which was an invoicing API with a separate web app. They are **v1 drafts awaiting the owner's or a lawyer's approval**. Until then `AGREEMENTS_ENABLED` stays `false`, so no company is asked to accept them and go-live doesn't require them.

Editing a text and deploying publishes a new version, and companies that accepted an older one are asked to accept again.

## What was changed from the previous texts

Only statements that are untrue for this product were removed or reworded. Nothing else was rewritten.

**All three**
- Removed every reference to the API, to API-only use and to `comprobify-web` as a separate product.
- Removed the paragraphs on AI assistants connected through OAuth. That integration is planned after the MVP (PRD 5.14); restore and review the wording when it ships.

**Privacy Policy**
- Section 1: "prestación de la API de facturación electrónica" became "servicio de facturación electrónica y gestión empresarial (ERP)".
- Section 2: added two rows to the data table, for invited users (name, email, password hash, role, two-step configuration) and for business data (clients, suppliers, products, inventory, orders). Replaced the "web interface" paragraph with a "Datos de operación" paragraph covering the same.
- Section 4: sub-processors reduced to what this system uses; removed CloudAMQP (no RabbitMQ) and the web-only hosting line.
- Section 5: replaced the security measures that no longer exist (API keys stored as hashes, account recovery by certificate, signed webhooks, rate limiting per API key) with the ones that do: password hashes, optional two-step verification that a company can require, single-use expiring links that only a confirmation consumes, rate limits per email and IP address, and lockout after wrong two-step codes. The RLS paragraph now describes per-company isolation.
- Section 6: replaced the Redis counters with the database counters actually used: hashed keys, deleted after one day.
- Section 7: the cookie paragraph no longer distinguishes API and web use.
- Sections 8 and 9: catalogs now cover clients, suppliers and products; the invited-users rights paragraph no longer refers to the web app.

**Terms of Service**
- Section 3: the stored-data paragraph now describes ERP data; removed the AI-assistant paragraph; credential recovery is now password reset by email, not certificate-based recovery.

**DPA**
- Sections 2, 3 and 7: data subjects now include the company's **suppliers**, and the client and supplier catalogs replace the web-only buyer catalog.
- Section 6: same sub-processor changes as the Privacy Policy; removed the AI-assistant paragraph.

## Open questions for the owner or a lawyer

1. **Deleting catalog entries.** The texts say the company can delete a client or supplier entry at any time. This system never hard-deletes rows: entries are deactivated (`CLAUDE.md`, rule 12). Either the texts change, or a real suppression path is built for personal data outside authorized documents (LOPDP).
2. **Log retention of three days.** The Privacy Policy promises that technical logs with IP addresses are kept at most three days. The Betterstack retention must be configured to match before production, or the text must change.
3. **Suppliers as data subjects** are new in the DPA. Confirm the wording, since suppliers are often companies and only natural persons are protected by the LOPDP.
4. **ERP data in general** (inventory, purchases, orders) is described in one sentence per text. A lawyer should check that this is enough.
5. **Operator details.** The texts name the operator as a natural person with a RUC. They come from `OPERATOR_NAME`, `OPERATOR_RUC`, `OPERATOR_ADDRESS` and `SUPPORT_EMAIL`, set when agreements are enabled.
6. **Placeholders.** Each company's accepted copy fills `{{cliente.razonSocial}}`, `{{cliente.ruc}}`, `{{operador.*}}` and `{{soporte.email}}`, and that copy is stored exactly as shown.
