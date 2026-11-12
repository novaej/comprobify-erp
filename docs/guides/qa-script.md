# QA script

One manual pass of the whole system on your machine, before Milestone 10's deploy work. It is made of small flows. Run one, write down what you saw, send the feedback, and run it again once it is fixed before going to the next. Each flow says what it **needs** from earlier ones and what it **leaves** for later ones, so the database is reset once, at the start, and every flow builds on the last.

Everything here runs locally: the mock SRI answers like SRI, emails are written to the terminal, and two helper commands stand in for time passing. A few things only real services can show; they are in [Part R](#part-r-real-services-optional), optional, and in [What this script does not cover](#what-this-script-does-not-cover).

## How to give feedback

For each flow, one line per problem:

```
B3 · step 4 · Expected the branch limit message; got a blank error.
```

Add a screenshot when the problem is how something looks. "Looks wrong" is enough to start with. Mark a flow ✅ when every step matched, or ❌ with the step numbers that didn't, in the [Progress](#progress) table. Retest a flow from its first step once its fix lands.

| Part | Flows |
|---|---|
| 0 | [Prerequisites](#part-0-prerequisites) |
| P | [The public pages](#part-p-the-public-pages) · P1–P3 |
| A | [Accounts](#part-a-accounts) · A1–A3 |
| B | [The company](#part-b-the-company) · B1–B4 |
| C | [Plan and payments](#part-c-plan-and-payments) · C1–C5 |
| D | [Master data](#part-d-master-data) · D1–D4 |
| E | [Inventory](#part-e-inventory) · E1–E3 |
| F | [Documents](#part-f-documents) · F1–F7 |
| G | [Purchasing](#part-g-purchasing) · G1–G3 |
| H | [Sales and receivables](#part-h-sales-and-receivables) · H1–H3 |
| I | [Bulk invoicing](#part-i-bulk-invoicing) · I1–I2 |
| J | [Users and roles](#part-j-users-and-roles) · J1–J4 |
| K | [Notifications](#part-k-notifications) · K1–K3 |
| L | [Dashboard and reports](#part-l-dashboard-and-reports) · L1–L3 |
| M | [Going live](#part-m-going-live) · M1–M3 |
| N | [The platform area](#part-n-the-platform-area) · N1–N7 |
| R | [The real SRI (optional)](#part-r-the-real-sri-optional) · R1 |

## Progress

Keep this table up to date as you go: ✅ passed, ❌ failed (note the steps), 🟡 partly done, ⬜ not run. Edit the file directly; the flows below are in the same order.

| Flow | What | Status |
|---|---|---|
| P1 | The landing page | ✅ |
| P2 | Pricing | 🟡 steps 1–4 passed; 5 and 6 need a company and the operator |
| P3 | Support | ✅ |
| A1 | Register and confirm the email | ✅ |
| A2 | Sign out, a wrong password, a reset | ✅ |
| A3 | The operator: super admin with two-step verification | ⬜ |
| B1 | Set up the company | ⬜ |
| B2 | The legal documents | ⬜ |
| B3 | Company settings | ⬜ |
| B4 | What the free plan includes | ⬜ |
| C1 | Choose a plan and report the transfer | ⬜ |
| C2 | The operator verifies the payment | ⬜ |
| C3 | The operator invoices the payment | ⬜ |
| C4 | A document pack, closed without an invoice | ⬜ |
| C5 | Pay by card through Payphone | ⬜ |
| D1 | Products and services | ⬜ |
| D2 | Clients | ⬜ |
| D3 | Providers | ⬜ |
| D4 | Products and clients by CSV | ⬜ |
| E1 | Opening balances | ⬜ |
| E2 | Adjustments | ⬜ |
| E3 | Valuation and the nightly check | ⬜ |
| F1 | An invoice, from the keyboard | ⬜ |
| F2 | Consumidor final and its limit | ⬜ |
| F3 | Templates | ⬜ |
| F4 | A credit note | ⬜ |
| F5 | A guía de remisión | ⬜ |
| F6 | Void an invoice | ⬜ |
| F7 | Finding documents | ⬜ |
| G1 | A purchase order | ⬜ |
| G2 | Receive it in parts | ⬜ |
| G3 | Cancel an order | ⬜ |
| H1 | A sale order holds stock | ⬜ |
| H2 | Invoice the order in parts | ⬜ |
| H3 | Collect and the aging report | ⬜ |
| I1 | From sale orders | ⬜ |
| I2 | From a CSV | ⬜ |
| J1 | Invite the team | ⬜ |
| J2 | What each role sees and may do | ⬜ |
| J3 | Limit, change and remove | ⬜ |
| J4 | Two-step verification for everyone | ⬜ |
| K1 | The bell and preferences | ⬜ |
| K2 | Authorizations, grouped | ⬜ |
| K3 | The certificate about to expire | ⬜ |
| L1 | The dashboard | ⬜ |
| L2 | Reports | ⬜ |
| L3 | The accountant's export | ⬜ |
| M1 | Take the company to production | ⬜ |
| M2 | The first production invoice | ⬜ |
| M3 | The quota fills up | ⬜ |
| N1 | A company's plan, exceptions and suspension | ⬜ |
| N2 | Prices and the IVA | ⬜ |
| N3 | Plans and modules | ⬜ |
| N4 | The email editor | ⬜ |
| N5 | Jobs and notices | ⬜ |
| N6 | The platform log | ⬜ |
| N7 | SRI's answers for a document | ⬜ |
| R1 | The real SRI, test environment | ⬜ |

---

## Part 0: Prerequisites

### 0.1 Settings

In your `.env` (copied from `.env.example`), set these, then leave everything else as it is:

```bash
# The legal texts on, with whatever text they have today (not yet reviewed).
AGREEMENTS_ENABLED=true
OPERATOR_NAME=Comprobify Operadora S.A.
OPERATOR_RUC=1790012345001
OPERATOR_ADDRESS=Av. Amazonas N24-03, Quito
SUPPORT_EMAIL=soporte@comprobify.test

# The account companies transfer to, shown beside each payment. All five, or none.
BANK_TRANSFER_BANK_NAME=Banco Pichincha
BANK_TRANSFER_ACCOUNT_TYPE=Corriente
BANK_TRANSFER_ACCOUNT_NUMBER=2100123456
BANK_TRANSFER_ACCOUNT_HOLDER=Comprobify Operadora S.A.
BANK_TRANSFER_IDENTIFICATION=1790012345001
```

Keep `SRI_MOCK_MODE=true` (the mock SRI answers like SRI; see [R1](#r1--the-real-sri-test-environment) for the real one).

**Emails: real ones, to your inbox (recommended).** With a Mailgun key and domain set and `EMAIL_PROVIDER` left empty, the worker really sends. Add `EMAIL_REDIRECT_TO` so every email of the run comes to your address instead of the made-up ones (`owner@andina.test` and the rest don't exist):

```bash
MAILGUN_API_KEY=<your key>
MAILGUN_DOMAIN=<your sending domain>
MAILGUN_REGION=us            # or eu
EMAIL_FROM=Comprobify <no-reply@<your sending domain>>
EMAIL_REDIRECT_TO=<your own address>
```

Each email arrives with `[REDIRIGIDO]` in the subject and a red line saying who it would have gone to, so you can tell the owner's from the invitee's. A Mailgun *sandbox* domain only delivers to addresses you authorized in its console: authorize the redirect address there. The buyer's copy of an invoice carries the RIDE and XML, so you see the real attachment too.

**Emails: only in the terminal.** Leave the Mailgun lines unset (or set `EMAIL_PROVIDER=log`) and nothing is sent: the worker writes each email to the `pnpm dev` terminal, link included.

**Cards through Payphone (to run flow C5).** Payphone's widget only renders on a domain registered in its console, so this needs its test application and an address it accepts:

```bash
PAYPHONE_TOKEN=<test application token>
PAYPHONE_STORE_ID=<its store id>
```

Register the address you open the app on and `<address>/es/plan/card-return` as the return address (steps in [payphone-test-card.md](payphone-test-card.md)). I have not checked whether Payphone accepts `localhost`. If it doesn't, give the app a public https address with a tunnel (Cloudflare Tunnel or ngrok both work), register that, set `APP_URL=<that address>` in `.env`, and open the app through it for the whole run. Without Payphone credentials, skip C5: the card flow is covered by the automated tests against a fake Payphone, and only the real widget is untested.

### 0.2 A clean database

```bash
pnpm db:reset local     # type the database name when asked; it migrates too
```

This clears only `comprobify_erp_local`, the one `pnpm dev` uses. The test and E2E databases are not touched.

### Attempt limits

The app limits abuse, and a long test run can reach it ("Demasiados intentos"). Each limit counts per email or per IP address (the device's network address; locally none is seen, so only the per-email limits apply) and resets by itself: sign-in 5 wrong passwords per 15 minutes per email; password reset links 3 per hour per email; confirmation emails 5 per hour per email; sign-ups 5 per hour per IP address, so locally never. A2 asks for four reset links, so wait an hour between the first and last, or clear the counters during a run:

```bash
docker exec postgres18 psql -U comprobify_erp_owner -d comprobify_erp_local -c "DELETE FROM rate_limit_hits"
```

### 0.3 Test certificates

From the repository root:

```bash
pnpm test-certificate 1712345678001      # the customer company, Comercial Andina
pnpm test-certificate 1790012345001      # the operator's own company, which invoices payments
pnpm test-certificate 1714070046001 10   # a second company whose signature expires in 10 days
```

Each writes `test-<ruc>.p12` in the repository root; the password is `secret`. They are git-ignored.

**Using your own signature.** You can use your own `.p12` and RUC for **Comercial Andina**, the main company, instead of the first generated one. Only that one: a RUC belongs to one company, the certificate must match its company's RUC, and the other two need the generated ones (the operator's RUC is the `OPERATOR_RUC` of 0.1, and a certificate that ends in 10 days can't be a real one). Then:

- Skip the first command, and wherever this script says `1712345678001`, `Comercial Andina` and `test-1712345678001.p12`, use your RUC, your legal name and your file with your password. The place it matters is **C3**: recording the operator's invoice checks that the buyer's RUC is the company's.
- While `SRI_MOCK_MODE=true` nothing reaches SRI, and locally every document is issued for SRI's test environment even after going live (M1), so signing is the only real part. The same company then serves the real-SRI flow R1.
- Your private key is stored, encrypted, in the local database with the placeholder key of `.env.example`. Reset the database when you are done (`pnpm db:reset local`), and never commit the file.

### 0.4 Start

```bash
pnpm dev
```

Wait for the worker's `Worker started`. Open http://localhost:3000/es.

**Where emails go.** With Mailgun set (0.1), to your inbox; open the links from there. Without it, nothing is sent: the worker writes each email to the `pnpm dev` terminal as an `email.logged` line, with the address, the template and the link, and a step that says "open the link in the email" means copy it from there. Either way, steps that mention "in the terminal" mean: in your inbox when emails are real.

**Running a scheduled job now.** Some checks run on a schedule (the certificate check at 07:00, the quota every 15 minutes). To run one immediately, with `pnpm dev` running:

```bash
pnpm run-job <queue>      # with no queue, it lists the ones you can run
```

### 0.5 Browsers and apps

- Several people use the system at once. Give each one its own browser profile or private window, so their sessions don't mix: **Owner**, **Operator**, and one per invited member in Part J.
- An authenticator app on your phone (Google Authenticator, 1Password, any TOTP app), for two-step verification.
- A small PNG or PDF to use as a transfer proof.
- Excel or Numbers, to open CSV files.

### 0.6 Test data

Use these throughout, so later flows can refer to them. All passwords: `una clave de prueba larga`.

| Who | Email | Role |
|---|---|---|
| Ana Owner | `owner@andina.test` | Owner of Comercial Andina |
| Oscar Operator | `operator@comprobify.test` | Super admin; owner of Comprobify Operadora |
| Adela Admin | `admin@andina.test` | Administrador |
| Víctor Ventas | `ventas@andina.test` | Ventas |
| Bruno Bodega | `bodega@andina.test` | Compras y bodega |
| Carla Contadora | `contadora@andina.test` | Contador |
| Lucía Lectura | `lectura@andina.test` | Solo lectura |

| Thing | Value |
|---|---|
| Customer company | Comercial Andina S.A., RUC `1712345678001` (or your own RUC and legal name, if you use your own signature: see 0.3) |
| Operator company | Comprobify Operadora S.A., RUC `1790012345001` |
| Second company | Andina Norte S.A., RUC `1714070046001` (signature expires in 10 days) |
| Client, person | María Pérez, cédula `1710034065`, `maria@cliente.test` |
| Client, company | Distribuidora Sur S.A., RUC `0992339411001`, `compras@sur.test` |
| Provider | Importadora Andes S.A., RUC `1710104257001`, `ventas@andes.test` |
| Product, good | `CAF-1` Café molido, $5.50, IVA 15 %, tracks stock |
| Product, good | `TE-1` Té verde, $3.20, IVA 15 %, tracks stock |
| Service | `SRV-1` Instalación, $30.00, IVA 15 %, no stock |

---

## Part P: The public pages

Seen signed out, so use a private window. They need no company; run them any time after Part 0, and P2's last step after N2.

### P1 · The landing page

**Needs:** Part 0.

| # | Do | Expect |
|---|---|---|
| 1 | http://localhost:3000 | The landing page in Spanish: the headline, a sample invoice that steps through Firmado, Recibido, Autorizado and stamps "Autorizado por el SRI", three short points, **Crear cuenta gratis** |
| 2 | **Ver cómo funciona**, and the header's **Cómo empezar** | Scrolls to the three steps. After a moment the picture beside them goes from sign-up to company to invoice, one every two seconds, and the line fills. Clicking a step's circle shows its picture |
| 3 | Look at the comprobantes strip | Factura, Nota de crédito and Guía de remisión ticked; Retención and Liquidación de compra marked as coming |
| 4 | Look at the plans | Gratis, Emprende, Negocio, Empresa with prices before IVA and their monthly documents; one marked **Más popular** |
| 5 | Open two questions in the FAQ | Each opens and closes; opening one closes the other |
| 6 | Header: **EN**, the theme button, then the phone width (browser's responsive mode) | English; dark theme; on the phone the links move into the menu button, and nothing scrolls sideways |
| 7 | **Crear cuenta gratis** | The registration form |
| 8 | Signed in as Ana, open `/es` | The header shows **Ir a mi cuenta** instead of the sign-in links |

### P2 · Pricing

**Needs:** Part 0. Step 6 needs N2 done.

| # | Do | Expect |
|---|---|---|
| 1 | Header → **Precios** | The four plans with prices before IVA ("+ IVA"), their limits and the modules each includes |
| 2 | **Anual** | Prices are ten months' worth; "Equivalente a … /mes" appears; documents become a year's worth |
| 3 | Look under the cards | The extra-user price, the payment methods, the add-on modules with prices |
| 4 | **Compara los planes**: scroll the table sideways on the phone width | Limits and a tick or dash per module; the table scrolls inside itself, not the page |
| 5 | Signed in as Ana (after B1), open **Plan y pagos** in the sidebar and click **Elegir un plan** (monthly and yearly) | The same plans, with the same prices before IVA as the public page: Emprende, Negocio and Empresa, monthly and yearly. Gratis is not offered there, since a free plan isn't bought |
| 6 | As the operator, publish a new price for Negocio (N2, the earliest date), then reload the pricing page after 30 seconds | Negocio still shows today's price, with "El precio cambia a … a partir del …". With a date of today (a plan nobody pays) the new price shows instead |

### P3 · Support

**Needs:** Part 0 (`SUPPORT_EMAIL` set; add `SUPPORT_PHONE=+593…` to try the WhatsApp card).

| # | Do | Expect |
|---|---|---|
| 1 | Header → **Soporte**, or the footer's **Soporte** | The email card, and a WhatsApp card if `SUPPORT_PHONE` is set; the email opens your mail app, the number opens WhatsApp |
| 2 | Set `AGREEMENTS_ENABLED=false` (the legal texts need `SUPPORT_EMAIL`), empty `SUPPORT_EMAIL`, restart, reload | "No hay datos de contacto configurados todavía." |

---

## Part A: Accounts

### A1 · Register and confirm the email

**Needs:** Part 0. **Leaves:** Ana's account, signed in.

| # | Do | Expect |
|---|---|---|
| 1 | Owner window: http://localhost:3000 | It goes to `/es`, the landing page (P1), in Spanish. **Crear cuenta** in its header leads to the form |
| 2 | **Crear cuenta**: Ana Owner, `owner@andina.test`, the password twice | A "check your email" page |
| 3 | In the terminal, find the `verifyEmail` email for `owner@andina.test` and open its link | A page with a **Confirmar mi correo** button; nothing is confirmed just by opening it |
| 4 | Click **Confirmar mi correo** | Signed in, sent to set up a company |
| 5 | Sign out, then open the same link again, and press **Confirmar mi correo** | It says the link is not valid or already expired. (Signed in, the page sends you on to the app instead.) |

### A2 · Sign out, a wrong password, a reset

**Needs:** A1. **Leaves:** Ana signed in.

| # | Do | Expect |
|---|---|---|
| 1 | Sign out (account menu) | Back at the sign-in page |
| 2 | Sign in with a wrong password | A clear "wrong email or password" message, no detail of which one |
| 3 | **¿Olvidaste tu contraseña?**, enter `owner@andina.test` | "If the account exists, we sent a link" |
| 4 | In the terminal, find the `resetPassword` email for `owner@andina.test` and open its link. Type a new password twice, for example `otra clave de prueba larga`, and submit | You land on the sign-in page with a "password changed" message |
| 5 | Sign in with `otra clave de prueba larga` | Signed in. Sign out |
| 6 | Try to sign in with the old one, `una clave de prueba larga` | Refused with the "wrong email or password" message |
| 7 | Clear the counters (Attempt limits, above), then repeat steps 3 and 4 to set it back to `una clave de prueba larga`, then sign in with it | Signed in, and the other password no longer works. (Everything after this assumes the original password.) |
| 8 | Open the first reset link again (the one used in step 4) | It says the link was already used or expired, with no password form |
| 9 | Clear the counters again if you hit the limit, then ask for two reset links in a row, then open the first | It says the link was already used or expired; the second one works |
| 10 | Switch the language to EN and back, and the theme to dark and back | Everything changes at once and stays after a reload |

### A3 · The operator: super admin with two-step verification

**Needs:** A1. **Leaves:** Oscar, a super admin with 2FA, signed in to the platform area.

| # | Do | Expect |
|---|---|---|
| 1 | Operator window: register `operator@comprobify.test` and confirm it, as in A1 | Signed in, asked to set up a company. Leave it for now |
| 2 | Visit http://localhost:3000/es/admin | "Página no encontrada": the area isn't advertised |
| 3 | In a terminal: `pnpm super-admin operator@comprobify.test` | "…is now a super admin." |
| 4 | Visit `/es/admin` again | Sent to **Mi cuenta**, asked to turn on two-step verification first |
| 5 | Turn it on: scan the QR with the app, enter a code, save the backup codes | Two-step verification on |
| 6 | Visit `/es/admin` | **Empresas**, the platform area, with its own menu and a **Plataforma** badge |
| 7 | Sign out and in again | Asked for the authenticator code after the password |

---

## Part B: The company

### B1 · Set up the company

**Needs:** A1. **Leaves:** Comercial Andina, in its test copy (Pruebas).

| # | Do | Expect |
|---|---|---|
| 1 | Owner window: fill the company form with RUC `1712345678001`, Comercial Andina S.A., an address, the main branch `001` Matriz, issue point `001` | Fields check as you go: a RUC with a bad structure is refused |
| 2 | Upload `test-1712345678001.p12`, password `secret` (or your own file and password) | Accepted. Try once with a wrong password first: refused, clearly |
| 3 | **Crear mi empresa** | The dashboard, "Tu empresa está lista", a yellow "ambiente de pruebas" banner, **SRI Pruebas** in the sidebar |
| 4 | Look at the sidebar | The organization switcher, Pruebas selected; Producción disabled with "Disponible cuando tu empresa pase a producción" |
| 5 | In a fresh company form (don't submit), upload `test-1790012345001.p12` with the company's RUC | Refused: the certificate's RUC doesn't match |

### B2 · The legal documents

**Needs:** B1. **Leaves:** Comercial Andina has accepted the terms.

| # | Do | Expect |
|---|---|---|
| 1 | Dashboard | A blue banner "Acepta los documentos legales" with **Revisar y aceptar** |
| 2 | **Revisar y aceptar** | Three documents (Términos, Privacidad, Acuerdo de Procesamiento de Datos), each **Pendiente** |
| 3 | Open each | The company's own copy: Comercial Andina's name and RUC and the operator's details filled in, no `{{…}}` left |
| 4 | Back, tick "He leído y acepto, en nombre de mi empresa", **Aceptar** | "Documentos aceptados.", each "Aceptado el …" |
| 5 | Dashboard | The banner is gone |
| 6 | **Actividad** in the sidebar | The acceptance is in the log, with who and when |

### B3 · Company settings

**Needs:** B1. **Leaves:** settings as you made them; one branch and one issue point.

| # | Do | Expect |
|---|---|---|
| 1 | **Empresa** in the sidebar | Tax data, the certificate, branches and issue points |
| 2 | **Editar los datos tributarios**: set **RIMPE Emprendedor**, save; then set it back | Saved each time; the change appears in **Actividad** |
| 3 | Upload a logo (a PNG) | Shown on the page |
| 4 | **Agregar establecimiento** | Refused: the Gratis plan allows one branch (this changes after C2) |
| 5 | Open the issue point 001-001's document types | Factura on; the others follow the plan |

### B4 · What the free plan includes

**Needs:** B1. **Leaves:** nothing new.

| # | Do | Expect |
|---|---|---|
| 1 | **Plan** in the sidebar | Gratis, its modules and limits (5 documents, 1 user, 1 branch), and **Elegir un plan** |
| 2 | Open **Inventario**, **Órdenes de compra**, **Pedidos de venta**, **Facturación masiva** | Each shows a lock: "tu plan no incluye…", with a link to the plan |
| 3 | **Usuarios** → **Invitar** | Refused: the plan allows one user |

---

## Part C: Plan and payments

### C1 · Choose a plan and report the transfer

**Needs:** B1, A3. **Leaves:** a reported payment for Empresa; a notice for the operator.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: **Plan** → **Elegir un plan** | The self-service plans and their prices (placeholders), monthly and yearly |
| 2 | Choose **Empresa**, monthly, **Continuar al pago** | A payment "Plan Empresa, mensual", **$91,89** (79,90 + 15 % IVA), "Por pagar" |
| 3 | Look at **Transferencia** | The bank details from 0.1 and how much to transfer |
| 4 | **Enviar comprobante**: a reference, the PNG | "En revisión"; the file is listed |
| 5 | Operator window, platform area | A **1** on the bell; "Hay un pago por revisar" with Comercial Andina and $91,89; a `paymentReported` email in the terminal |
| 6 | Click the notice | **Pagos**, with the payment first |

### C2 · The operator verifies the payment

**Needs:** C1. **Leaves:** Comercial Andina on Empresa; a payment owed an invoice.

| # | Do | Expect |
|---|---|---|
| 1 | Operator: **Pagos** → the payment | The proof shown inline, the amount, the company |
| 2 | **Verificar** → confirm | "Pago verificado." and a **Devolver** (refund) button |
| 3 | Owner: reload the dashboard | The bell has "Pago confirmado"; a `paymentVerified` email in the terminal |
| 4 | **Plan** | Empresa, its modules and limits, the period dates |
| 5 | Open the pages locked in B4 | All open now |
| 6 | **Empresa** → **Agregar establecimiento**: `002` Norte, with an issue point `001` | Allowed now; the twin and the real company both get it |

### C3 · The operator invoices the payment

**Needs:** C2. **Leaves:** the operator's company with one invoice; the payment invoiced.

| # | Do | Expect |
|---|---|---|
| 1 | Operator window: **Mi cuenta** → **Configurar mi empresa**: RUC `1790012345001`, Comprobify Operadora S.A., `test-1790012345001.p12` | The company, in its test copy, beside the platform area |
| 2 | In it, create a client: Comercial Andina, with the company's RUC (`1712345678001`, or yours) | Created |
| 3 | **Nueva factura** for that client: one line "Plan Empresa, mensual", 1 × 79,90, IVA 15 %, paid by transfer | Total $91,89; **Emitir factura** → authorized by the mock SRI within seconds |
| 4 | Copy the invoice's 49-digit access key from its page | |
| 5 | Platform area → **Por facturar** | Comercial Andina's payment, with **Registrar factura** and **Sin factura** |
| 6 | **Registrar factura** with a wrong key (49 ones) | Refused: no invoice has that key |
| 7 | **Registrar factura** with the real key | The payment leaves the queue; Comercial Andina's **Actividad** shows "registró la factura de un pago" |

### C4 · A document pack, closed without an invoice

**Needs:** C2. **Leaves:** a pack of documents in Comercial Andina (used in M3).

| # | Do | Expect |
|---|---|---|
| 1 | Owner: **Plan** → **Paquetes de comprobantes** → buy the smallest | A payment for the pack |
| 2 | Report a transfer for it, as in C1 | "En revisión" |
| 3 | Operator: verify it | The owner's plan page shows the pack's documents |
| 4 | Operator: **Por facturar** → **Sin factura** on it; try with no reason, then "Prueba del QA" | Refused without a reason; then "Pago cerrado sin factura." and it leaves the queue |
| 5 | Owner: **Actividad** | "cerró un pago sin factura", with the reason |

### C5 · Pay by card through Payphone

**Needs:** C2, and the Payphone settings of 0.1 (skip this flow without them). **Leaves:** a paid pack and a payment by card; a notice for the operator.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: **Plan** → **Paquetes de comprobantes** → buy the smallest again | A payment card "Por pagar", with **Transferencia** and **Tarjeta** |
| 2 | **Tarjeta** | Payphone's widget loads below |
| 3 | Pay with Payphone's test card | Payphone sends you back to `/es/plan/card-return`; "Pago aprobado" |
| 4 | **Volver al plan** | The pack's documents are added; the payment shows "Pagado", by card |
| 5 | Reload the return page | "Pago aprobado" again, and no second charge in Payphone's dashboard |
| 6 | Operator: the bell | "Se aplicó un pago con tarjeta"; a `cardPaymentApplied` email |
| 7 | Operator: **Por facturar** | The payment, method **Tarjeta**, owed an invoice; record or close it as in C3 and C4 |
| 8 | Owner: buy another pack, **Tarjeta**, and decline with Payphone's declined test card | "El pago no se completó"; the payment is still "Por pagar" and can be paid by transfer |

If the widget doesn't load, or the return page shows an error, see "If something goes wrong" in [payphone-test-card.md](payphone-test-card.md).

---

## Part D: Master data

All of Parts D to L happen in Comercial Andina's **test copy** (Pruebas). Part M takes it live.

### D1 · Products and services

**Needs:** C2. **Leaves:** CAF-1, TE-1, SRV-1.

| # | Do | Expect |
|---|---|---|
| 1 | **Productos** → **Nuevo producto**: `CAF-1` Café molido, bien, $5,50, cost $2,25, IVA 15 %, **Controla inventario** on, unit kg, one additional detail "Origen: Loja" | Created, listed |
| 2 | Create `TE-1` Té verde, $3,20, IVA 15 %, controls stock | Created |
| 3 | Create `SRV-1` Instalación, servicio, $30, IVA 15 % | Created; a service can't track stock (the option is off or refused) |
| 4 | Create another `CAF-1` | Refused: the code exists |
| 5 | Search "caf" | Only Café molido |
| 6 | Deactivate SRV-1, then reactivate it | Each asks first; the badge changes |

### D2 · Clients

**Needs:** D1. **Leaves:** María Pérez and Distribuidora Sur.

| # | Do | Expect |
|---|---|---|
| 1 | **Clientes** → **Nuevo cliente**: cédula `1710034066` | Refused: the check digit is wrong |
| 2 | María Pérez, cédula `1710034065`, `maria@cliente.test`, 30 days of credit | Created |
| 3 | Distribuidora Sur S.A., RUC `0992339411001`, `compras@sur.test` | Created |
| 4 | Edit María's phone | Saved |

### D3 · Providers

**Needs:** C2. **Leaves:** Importadora Andes.

| # | Do | Expect |
|---|---|---|
| 1 | **Proveedores** → **Nuevo proveedor**: Importadora Andes S.A., RUC `1710104257001`, `ventas@andes.test` | Created |
| 2 | Edit and save | Saved |

### D4 · Products and clients by CSV

**Needs:** D1, D2. **Leaves:** a few more products and one more client.

| # | Do | Expect |
|---|---|---|
| 1 | **Productos** → **Exportar CSV**, open it in Excel | One row per product, Spanish headers, `;` columns and decimal commas, "si"/"no" |
| 2 | **Importar CSV** → **Descargar plantilla**, open it | A model with two rows |
| 3 | Make a file with three rows: `AZU-1` Azúcar (bien, 1,10, IVA 4); `BAD-1` with IVA `99`; another `AZU-1` | |
| 4 | Import it | Nothing imported; "Línea 3: revisa la columna «IVA»", "Línea 4: el código ya aparece antes en el archivo" |
| 5 | Remove the two bad rows, import again | "Se creó 1 producto." Azúcar listed |
| 6 | Import the export from step 1, unchanged | Updated, none created, nothing changed |
| 7 | **Clientes** → **Importar CSV** with: `05;1700000001;Pedro Ruiz;pedro@cliente.test` (and the header from the template) | "Se creó 1 cliente." |
| 8 | Change CAF-1's price in a CSV to 6,00 and import | CAF-1 updated to $6,00; set it back to 5,50 the same way |

---

## Part E: Inventory

### E1 · Opening balances

**Needs:** D1. **Leaves:** CAF-1 50 kg at $2,25 and TE-1 30 at $1,40 in Matriz.

| # | Do | Expect |
|---|---|---|
| 1 | **Inventario** | The stocked products at zero, one row per warehouse (Matriz, Norte) |
| 2 | CAF-1 → **Registrar saldo inicial**: Matriz, 50, cost 2,25 | On hand 50, average cost 2,25 |
| 3 | **Importar saldos iniciales** with a file: `TE-1;001;30;1,40` and `CAF-1;001;10;2,00` | Refused, line 3: CAF-1 already has movements in that warehouse |
| 4 | Remove the CAF-1 line and import | "Se importó 1 saldo inicial."; TE-1 at 30 |

### E2 · Adjustments

**Needs:** E1. **Leaves:** CAF-1 at 48.

| # | Do | Expect |
|---|---|---|
| 1 | CAF-1 → **Ajustar existencias**: out 2, reason "Merma" | 48 on hand; a movement "Salida" with the reason |
| 2 | Out 1000 | Refused: not enough stock |
| 3 | **Empresa** → turn on **Permitir existencias negativas**, then off again | Saved each time |

### E3 · Valuation and the nightly check

**Needs:** E2. **Leaves:** nothing new.

| # | Do | Expect |
|---|---|---|
| 1 | **Inventario** → valuation | Each product's quantity, average cost and value; the total |
| 2 | Its CSV | Opens in Excel with the same figures |
| 3 | `pnpm run-job inventory.verify` | In the terminal: the check runs and finds no drift |

---

## Part F: Documents

### F1 · An invoice, from the keyboard

**Needs:** D2, E1. **Leaves:** one authorized invoice to María (A).

| # | Do | Expect |
|---|---|---|
| 1 | **Comprobantes** → **Nueva factura** | The form, the issue point preselected |
| 2 | Find María by typing "Mar" and pressing Enter; add CAF-1 × 2 and SRV-1 × 1 using the keyboard only | Totals update as you type: base 41,00, IVA 6,15, total 47,15 |
| 3 | Payment: transfer, 47,15 | Payments match the total |
| 4 | **Emitir factura** → confirm | The invoice page; within seconds "Autorizado", the authorization number, a timeline of events |
| 5 | **Ver PDF** (the RIDE) | The RIDE with the logo from B3, the lines and the access key |
| 6 | The XML link | The authorized XML |
| 7 | Terminal | A buyer email to `maria@cliente.test` with the RIDE and XML attached |
| 8 | **Inventario** → CAF-1 | 46 on hand; a "Venta" movement for the invoice |

### F2 · Consumidor final and its limit

**Needs:** D1, E1. **Leaves:** one consumidor final invoice.

| # | Do | Expect |
|---|---|---|
| 1 | **Nueva factura** with no client (consumidor final), TE-1 × 20 | Total above $50: refused when issuing, with the limit named |
| 2 | Change it to TE-1 × 5 | Issued and authorized |

### F3 · Templates

**Needs:** F1. **Leaves:** a template "Mantenimiento mensual".

| # | Do | Expect |
|---|---|---|
| 1 | In a new invoice, add SRV-1 × 1 and **Guardar como plantilla** "Mantenimiento mensual" | Saved |
| 2 | Start another invoice, **Cargar una plantilla** | The line comes back; cancel the invoice |

### F4 · A credit note

**Needs:** F1. **Leaves:** a credit note for part of invoice A.

| # | Do | Expect |
|---|---|---|
| 1 | Invoice A → **Nota de crédito** | A form with A's lines and what can still be credited |
| 2 | Credit CAF-1 × 1, tick **Devolver los productos al inventario**, a reason | **Emitir nota de crédito** → authorized |
| 3 | Invoice A and the note | Each links to the other |
| 4 | **Inventario** → CAF-1 | 47: one came back |
| 5 | Try to credit more than is left on A | Refused |

### F5 · A guía de remisión

**Needs:** F1. **Leaves:** a guía for invoice A.

| # | Do | Expect |
|---|---|---|
| 1 | Invoice A → **Guía de remisión** | The invoice's lines, a carrier and dates to fill |
| 2 | Carrier name and identification, plate **ABC-1234**, start and end dates | **Emitir guía de remisión** → authorized |
| 3 | Its RIDE | The transport section |

### F6 · Void an invoice

**Needs:** F2. **Leaves:** the consumidor final invoice voided.

| # | Do | Expect |
|---|---|---|
| 1 | The consumidor final invoice → **Marcar como anulada** | It asks for confirmation, and explains that you void it on SRI's site first |
| 2 | Confirm | The mock SRI says it's voided; the invoice shows "Anulado"; stock returns |

### F7 · Finding documents

**Needs:** F1–F6. **Leaves:** nothing new.

| # | Do | Expect |
|---|---|---|
| 1 | **Comprobantes** | Every document above, newest first, with status badges |
| 2 | Filter by status, by issue point, by dates; search by a number and by an access key | Each narrows the list; **Limpiar** brings it back |
| 3 | **Todo lo pendiente** | Nothing pending, or only what is waiting for SRI |

**SRI's refusals are not here:** the mock SRI authorizes everything, so a returned or not-authorized invoice, its correction and resend, and a send that never reached SRI can't be made by hand locally. They are covered by the automated tests, and by R1 with the real SRI.

---

## Part G: Purchasing

### G1 · A purchase order

**Needs:** D1, D3. **Leaves:** an order to Importadora Andes, sent.

| # | Do | Expect |
|---|---|---|
| 1 | **Órdenes de compra** → **Nueva orden**: Importadora Andes, warehouse Matriz, CAF-1 × 20 at 2,00, TE-1 × 10 at 1,50 | **Guardar borrador**: totals with IVA |
| 2 | Edit it: TE-1 × 12 | Saved as a new revision |
| 3 | **Ver PDF** | The order with the company's header and logo |
| 4 | **Enviar la orden por correo** to `ventas@andes.test` | Sent; the order is no longer a draft; a `purchasing` email with the PDF in the terminal |

### G2 · Receive it in parts

**Needs:** G1. **Leaves:** CAF-1 and TE-1 stocked from the order.

| # | Do | Expect |
|---|---|---|
| 1 | **Recibir mercadería**: CAF-1 × 10 now | "Parcialmente recibida"; CAF-1 up by 10, its average cost recalculated |
| 2 | Receive the rest | "Recibida"; TE-1 up by 12 |
| 3 | Try to receive more | Refused or nothing left to receive |
| 4 | **Inventario** → CAF-1 → movements | The receipts, with the order's cost |

### G3 · Cancel an order

**Needs:** D3. **Leaves:** one cancelled order.

| # | Do | Expect |
|---|---|---|
| 1 | New order for TE-1 × 5, save, then cancel it with a reason | It asks first; "Anulada" |

---

## Part H: Sales and receivables

### H1 · A sale order holds stock

**Needs:** D2, E1. **Leaves:** sale order PV-000001 confirmed, holding 10 CAF-1.

| # | Do | Expect |
|---|---|---|
| 1 | **Pedidos de venta** → **Nuevo pedido**: Distribuidora Sur, CAF-1 × 10 | **Guardar borrador** |
| 2 | **Confirmar pedido** | Confirmed; **Inventario** shows 10 CAF-1 reserved, available down by 10 |
| 3 | A second order, TE-1 × 2, confirm it, then **Anular pedido** | The reservation is released |

### H2 · Invoice the order in parts

**Needs:** H1. **Leaves:** PV-000001 invoiced in two invoices, closed.

| # | Do | Expect |
|---|---|---|
| 1 | PV-000001 → invoice it: 4 now, payment on credit (30 days) | An authorized invoice; the order "Parcialmente facturado" |
| 2 | Invoice the remaining 6 | "Facturado"; the reservation is gone, stock went down by 10 in all |
| 3 | Each invoice | Links back to the order |

### H3 · Collect and the aging report

**Needs:** H2, F1. **Leaves:** one invoice partly paid.

| # | Do | Expect |
|---|---|---|
| 1 | **Cuentas por cobrar** | The open invoices by age, Distribuidora Sur's two |
| 2 | One of them → **Registrar un cobro**, part of it | The balance goes down; "Pagada parcialmente" |
| 3 | **Registrar cobro** for the rest | "Pagada"; it leaves the report |
| 4 | **Anular cobro** on the second payment, with a reason | The balance is back |
| 5 | **Descargar CSV** on the report | Opens in Excel |

---

## Part I: Bulk invoicing

### I1 · From sale orders

**Needs:** H1. **Leaves:** one batch, completed.

| # | Do | Expect |
|---|---|---|
| 1 | Create and confirm two sale orders: María CAF-1 × 1, Distribuidora Sur TE-1 × 1 | Confirmed |
| 2 | **Facturación masiva** → **Nueva facturación masiva** | The confirmed orders, an issue point and a payment method |
| 3 | Tick both → **Facturar 2 pedidos** → confirm | The batch page: items queued, then made, then authorized, live |
| 4 | Wait for it to finish (a minute) | "Completado"; the bell: "Terminó un lote de facturas" |
| 5 | Platform area (operator) → **Cola de facturación** while one runs | The company with its items in flight |

### I2 · From a CSV

**Needs:** D1, D2. **Leaves:** a CSV batch.

| # | Do | Expect |
|---|---|---|
| 1 | **Facturación masiva** → **Importar CSV** → **Descargar plantilla** | A model where two rows share a reference: one invoice with two products |
| 2 | A file: `X-1;1710034065;CAF-1;2;;` / `X-1;1710034065;TE-1;1;;` / `X-2;;CAF-1;1;5,00;` / `X-3;;NO-EXISTE;1;;` | |
| 3 | **Revisar y facturar** | Nothing starts; "Línea 5: no existe un producto con ese código" |
| 4 | Remove X-3, send again | The batch page with two invoices, X-1 and X-2, made by the worker |
| 5 | X-1's invoice | Two lines |

---

## Part J: Users and roles

### J1 · Invite the team

**Needs:** C2. **Leaves:** five members, one per role.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: **Usuarios** → **Invitar** `admin@andina.test` as Administrador | An invitation listed as pending; an `invitation` email in the terminal |
| 2 | Invite the other four: Ventas, Compras y bodega, Contador, Solo lectura | Five pending |
| 3 | A private window per person: open each invitation link | "Te invitaron a Comercial Andina S.A." with a form |
| 4 | Each: a name, the password, **Crear mi cuenta y aceptar** | Signed in to Comercial Andina, in its test copy |

### J2 · What each role sees and may do

**Needs:** J1 and the data from D to I. **Leaves:** nothing new.

In each member's window, check the sidebar and try one thing they may not do:

| Role | Sees | Try | Expect |
|---|---|---|---|
| Administrador | Everything except taking the company live and the legal acceptance | **Pasar a producción** | Not offered |
| Ventas | Comprobantes, Clientes, Productos, Pedidos de venta, Cuentas por cobrar, Reportes | Open **Plan**, **Usuarios** | No access |
| Compras y bodega | Proveedores, Órdenes de compra, Inventario, Productos, Reportes | Create a sale order | No access |
| Contador | Everything to read, Reportes with downloads | Edit a product | Refused |
| Solo lectura | Everything to read except users, plan and activity | Download a report's CSV | No button; the URL refuses |

And for each: open a document or an order, so the read side is seen too.

### J3 · Limit, change and remove

**Needs:** J1. **Leaves:** Víctor limited to issue point 001-001; Lucía removed.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: limit Víctor (Ventas) to issue point **001-001** | Víctor's invoice form offers only that one |
| 2 | Change Bruno from Compras y bodega to Ventas, then back | His menu changes after a reload |
| 3 | Remove Lucía (**Quitar**) | It asks first; she is signed out of the company and can't open it again |
| 4 | **Actividad** | Each of these, with who did it |

### J4 · Two-step verification for everyone

**Needs:** J1. **Leaves:** 2FA required in Comercial Andina.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: **Mi cuenta** → turn on two-step verification | On, with backup codes |
| 2 | **Usuarios** → **Exigir verificación en dos pasos a todos los miembros** | Saved |
| 3 | Adela (Administrador) signs in | Sent to set it up before she can work |

---

## Part K: Notifications

### K1 · The bell and preferences

**Needs:** C2, F1, I1. **Leaves:** notices read.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: the bell | The notices so far: payment confirmed, batch finished, newest first, unread marked |
| 2 | Click one | Goes where it's about, and it's marked read |
| 3 | **Notificaciones** → **Sin leer**, **Marcar todas como leídas** | The list empties |
| 4 | The preferences | One row per type the owner receives, in-app and email; "Cambio de precio" locked on (mandatory) |
| 5 | Víctor (Ventas): **Notificaciones** | Document types only; no billing types |

### K2 · Authorizations, grouped

**Needs:** K1. **Leaves:** "Documentos autorizados" on for the owner.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: turn on **Documentos autorizados** (in the app) | Saved; it's off by default |
| 2 | Issue two invoices within a minute | One notice: "Se autorizaron 2 documentos" |
| 3 | Wait a minute, issue another | A new notice with 1 |

### K3 · The certificate about to expire

**Needs:** A1. **Leaves:** Andina Norte, a second company with a short-lived signature.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: the organization switcher → **Nueva empresa** (also on **Mi cuenta**): RUC `1714070046001`, Andina Norte S.A., `test-1714070046001.p12` | Andina Norte's dashboard, in its test copy; the switcher lists both, with their RUCs |
| 2 | Its dashboard | The certificate card: "Por vencer", the date 10 days out; a certificate banner |
| 3 | `pnpm run-job certificates.watch` | The bell in Andina Norte: "Tu firma electrónica vence pronto", 10 days; a `certificateExpiring` email in the terminal |
| 4 | Run it again | No second notice |
| 5 | Switch back to Comercial Andina | Its own notices only |

---

## Part L: Dashboard and reports

### L1 · The dashboard

**Needs:** D to I. **Leaves:** nothing new.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: **Panel** | Sales today and this month, which you can check against the invoices you issued; in progress and with problems; documents by status; top sellers; out of stock; documents this period; the signature |
| 2 | Click a status | The document list filtered by it |
| 3 | Víctor (Ventas) | No quota card (not his to see) |

### L2 · Reports

**Needs:** D to I. **Leaves:** nothing new.

| # | Do | Expect |
|---|---|---|
| 1 | **Reportes** | Ventas, Documentos emitidos, Resumen de impuestos, Cuentas por cobrar, Movimientos de inventario, Compras por proveedor, Valoración del inventario, and the accountant's export |
| 2 | **Ventas** by day, by client, by product | Each adds up to the same total; the credit note takes away; the voided invoice is not there |
| 3 | **Resumen de impuestos** | Base and IVA at 15 %, the same total as Ventas |
| 4 | **Documentos emitidos** | Every document of the month, with its status |
| 5 | **Movimientos de inventario**, **Compras por proveedor** | The receipts, sales and adjustments; the order to Importadora Andes, not the cancelled one |
| 6 | A date range ending before it starts | "La fecha final es anterior a la inicial." |
| 7 | **Descargar CSV** on each | Opens in Excel, the same rows |

### L3 · The accountant's export

**Needs:** J1, F1–F6. **Leaves:** nothing new.

| # | Do | Expect |
|---|---|---|
| 1 | Carla (Contador): **Reportes** → **Exportación para el contador**, this month, **Descargar ZIP** | A `comprobantes-AAAA-MM.zip` |
| 2 | Open it | `autorizados/` with one XML per authorized document, `anulados/` with the voided invoice |
| 3 | A month with nothing, e.g. 2020-01 | "No hay comprobantes autorizados en 2020-01." |

---

## Part M: Going live

### M1 · Take the company to production

**Needs:** B2, D1–D3. **Leaves:** Comercial Andina live.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: **Pasar a producción** (dashboard) | A page: the next number for each issue point and document, and "Llevar tus datos de pruebas" ticked |
| 2 | Set Factura on 001-001 to start at **101**; tick "Entiendo que este paso no se puede deshacer"; **Pasar a producción** | "Tu empresa está en producción", **SRI Producción** in the sidebar, no yellow banner |
| 3 | **Productos**, **Clientes**, **Proveedores** | The test copy's ones came along; documents and stock did not |
| 4 | The switcher: **Pruebas** | The test copy, its documents still there; switch back to **Producción** |
| 5 | **Actividad** | "pasó la empresa a producción" |

### M2 · The first production invoice

**Needs:** M1. **Leaves:** one production invoice, 001-001-000000101.

| # | Do | Expect |
|---|---|---|
| 1 | **Nueva factura** to María, SRV-1 × 1 | Number **001-001-000000101**, authorized (still the mock SRI, locally) |
| 2 | Its RIDE | No "pruebas" mark; the buyer's email in the terminal has no "[PRUEBAS]" |

### M3 · The quota fills up

**Needs:** M2, C4 (the pack). **Leaves:** the quota used, a pack partly spent.

| # | Do | Expect |
|---|---|---|
| 1 | Operator: **Empresas** → Comercial Andina → add an exception: **DOCUMENT_QUOTA** = 5, reason "QA" | Saved |
| 2 | Owner: issue invoices until 4 production documents exist this period | |
| 3 | `pnpm run-job quota.watch` | The bell: "Se acerca el límite de documentos", 80 % of 5; an email |
| 4 | Issue the 5th, run it again | "Llegaste al límite de documentos" |
| 5 | Issue a 6th | It goes through, spending one document from the pack bought in C4; **Plan** shows one less |
| 6 | Operator: remove the exception | The plan's 2000 again |

The test copy never uses quota: invoices in Pruebas don't count.

---

## Part N: The platform area

All as Oscar, in the operator window.

### N1 · A company's plan, exceptions and suspension

**Needs:** M1. **Leaves:** Comercial Andina active again.

| # | Do | Expect |
|---|---|---|
| 1 | **Empresas** → search "Andina" | Comercial Andina and Andina Norte, with plans and status |
| 2 | Comercial Andina | Its plan, modules, limits, exceptions, payments, activity |
| 3 | **Suspender**, reason **Saldo impago** | "Empresa suspendida." |
| 4 | Owner: try to issue an invoice | Refused; the plan page says the company is suspended; reading still works |
| 5 | Operator: **Reactivar** | The owner can issue again |

### N2 · Prices and the IVA

**Needs:** C2. **Leaves:** a price rise scheduled, the IVA unchanged.

| # | Do | Expect |
|---|---|---|
| 1 | **Precios** | Each plan, add-on, the seat and the packs, current and upcoming |
| 2 | Draft a higher price for Empresa, publish it for today | Refused: a rise needs 30 days' notice to companies that pay it |
| 3 | Publish it with the earliest date | Scheduled 30 days out; the owner gets "Cambia un precio de tu suscripción", which can't be switched off; an email |
| 4 | **IVA** → **Programar una tasa**: 13,5 % from 2099-01-01; then **Retirar** it | Scheduled, then withdrawn |

### N3 · Plans and modules

**Needs:** none. **Leaves:** a draft plan "QA".

| # | Do | Expect |
|---|---|---|
| 1 | **Planes** → **Nuevo plan** `QA` | A draft with the base module |
| 2 | Add **Inventario**, change a limit, then remove the module | All immediate: a draft has no companies |
| 3 | **Módulos** → open one | Its functions; adding or removing one on an available module is dated 30 days out |

### N4 · The email editor

**Needs:** none. **Leaves:** the texts as they were.

| # | Do | Expect |
|---|---|---|
| 1 | **Correos** | Every email, in Spanish and English, with its version |
| 2 | Open "Pago confirmado" in Spanish, change the heading, **Guardar borrador** | A draft; the version in use unchanged |
| 3 | **Vista previa** | The email as sent, with sample values |
| 4 | **Enviarme una prueba** | A "[Prueba]" email to `operator@comprobify.test` in the terminal |
| 5 | Remove `{amount}` from the body and save | Refused: the text needs it |
| 6 | Put it back, **Publicar** | The next "Pago confirmado" uses the new heading (verify a payment to see it) |
| 7 | In the history, **Usar como borrador** on version 1, publish | Back to the original text, as a new version |

### N5 · Jobs and notices

**Needs:** earlier flows. **Leaves:** nothing new.

| # | Do | Expect |
|---|---|---|
| 1 | **Trabajos** | Each queue with its counts, schedule, last run; no failed jobs, or a few with their error |
| 2 | `pnpm run-job retention.prune`, reload | Its last run updates |
| 3 | **Avisos** and the bell | The payments reported and the card payments, newest first |

### N6 · The platform log

**Needs:** N2–N4. **Leaves:** nothing new.

| # | Do | Expect |
|---|---|---|
| 1 | **Registro** | What you changed in N2–N5: prices, the IVA, the plan, the email, with you as the author |
| 2 | The filters (Precios, IVA, Correos…) | Each narrows the list and shows its count |

### N7 · SRI's answers for a document

**Needs:** F1. **Leaves:** a lookup in the log.

| # | Do | Expect |
|---|---|---|
| 1 | **Respuestas del SRI** with invoice A's access key | The company, the document, and each call: reception, then authorization, with HTTP, host, time and SRI's messages |
| 2 | **Ver la respuesta completa** | The raw XML SRI answered |
| 3 | A key of 48 digits, then 49 ones | "La clave de acceso tiene 49 dígitos."; then "No se encontró" |
| 4 | **Registro** → Soporte | "Consultó las respuestas del SRI de un comprobante" |

---

## Part R: The real SRI (optional)

Needs your own signature. Independent of everything above.

### R1 · The real SRI, test environment

The mock SRI authorizes everything, so a returned or not-authorized invoice, its correction and resend, and a send that never reached SRI can't be made by hand locally. This makes them with SRI's own test environment. With your own signature (a `.p12` for your RUC), against SRI's test environment (*celcer*), not production. In `.env`: `SRI_MOCK_MODE=false`; restart. Set up a company with your real RUC and certificate, and issue an invoice in its test copy. Expect a real authorization in SRI's test environment, then try what the mock can't do: an invoice to an identification SRI doesn't know (expect "No autorizado" with SRI's reason, then **Corregir y reenviar** as the same number), and **Reenviar** after it's authorized. Set `SRI_MOCK_MODE=true` again when done.

---

## What this script does not cover

These are covered by the automated tests, or need time to pass, or wait for Milestone 10:

- **The renewal cycle over days:** renewal due, grace, past due, the move to Gratis. Proven by the Milestone 8 gate on a fake clock. Locally a period is a month long.
- **SRI's refusals** with the mock (returned, not authorized, a send that failed, the next-day re-issue): the integration and E2E suites cover them; R1 shows them on the real SRI.
- **Load:** 1,000 invoices beside another company (`pnpm test:bulk-gate`) and the 10,000 of NFR-PERF-3, in Milestone 10.
- **Backups and restore, the data migration from the old system, a deploy:** Milestone 10.
- **Every screen in both themes and at phone width:** checked by the E2E suite with axe. If something looks wrong on your phone, report it in the flow where you saw it.
