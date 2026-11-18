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
| L | [Dashboard and reports](#part-l-dashboard-and-reports) · L1–L4 |
| M | [Going live](#part-m-going-live) · M1–M5 |
| N | [The admin area](#part-n-the-admin-area) · N1–N7 |
| R | [The real SRI (optional)](#part-r-the-real-sri-optional) · R1 |

## Progress

Keep this table up to date as you go: ✅ passed, ❌ failed (note the steps), 🟡 partly done, ⬜ not run. Edit the file directly; the flows below are in the same order.

| Flow | What | Status |
|---|---|---|
| P1 | The landing page | ✅ |
| P2 | Pricing | ✅ |
| P3 | Support | ✅ |
| A1 | Register and confirm the email | ✅ |
| A2 | Sign out, a wrong password, a reset | ✅ |
| A3 | The operator: super admin with two-step verification | ✅ |
| B1 | Set up the company | ✅ |
| B2 | The legal documents | ✅ |
| B3 | Company settings | ✅ |
| B4 | What the free plan includes | ✅ |
| C1 | Choose a plan and report the transfer | ✅ |
| C2 | The operator verifies the payment | ✅ |
| C3 | The operator invoices the payment | ✅ |
| C4 | A document pack, closed without an invoice | ✅ |
| C5 | Pay by card through Payphone | ✅ |
| D1 | Products and services | ✅ |
| D2 | Clients | ✅ |
| D3 | Providers | ✅ |
| D4 | Products and clients by CSV | ✅ |
| E1 | Opening balances | ✅ |
| E2 | Adjustments | ✅ |
| E3 | Valuation and the nightly check | ✅ |
| F1 | An invoice, from the keyboard | ✅ |
| F2 | Consumidor final and its limit | ✅ |
| F3 | Templates | ✅ |
| F4 | A credit note | ✅ |
| F5 | A guía de remisión | ✅ |
| F6 | Void an invoice | ✅ |
| F7 | Finding documents | ✅ |
| G1 | A purchase order | ✅ |
| G2 | Receive it in parts | ✅ |
| G3 | Cancel an order | ✅ |
| H1 | A sale order holds stock | ✅ |
| H2 | Invoice the order in parts | ✅ |
| H3 | Collect and the aging report | ✅ |
| I1 | From sale orders | ✅ |
| I2 | From a CSV | ✅ |
| J1 | Invite the team | ✅ |
| J2 | What each role sees and may do | ✅ |
| J3 | Limit, change and remove | ✅ |
| J4 | Two-step verification for everyone | ✅ |
| K1 | The bell and preferences | ✅ |
| K2 | Authorizations, grouped | ✅ |
| K3 | The certificate about to expire | ✅ |
| L1 | The dashboard | ✅ |
| L2 | Reports | ✅ |
| L3 | The accountant's export | ✅ |
| L4 | The activity log: account and operations | ✅ |
| M1 | Take the company to production | ✅ |
| M2 | The first production invoice | ✅ |
| M3 | The quota fills up | ✅ |
| M4 | Reset the test copy | ✅ |
| M5 | Hand the company over, and back | ✅ |
| N1 | A company's plan, exceptions and suspension | ✅ |
| N2 | Prices and the IVA | ✅ |
| N3 | Plans and modules | ✅ |
| N4 | The email editor | ✅ |
| N5 | Jobs and notices | ✅ |
| N6 | The admin log | ✅ |
| N7 | SRI's answers for a document | ✅ |
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
| Warehouses | Each branch has one: **Matriz** (branch `001`, issue point `001-001`) and **Norte** (branch `002`, made in C2 step 6). Use **Matriz** in every flow unless a step says Norte. Invoices take stock from the warehouse of their issue point, so from Matriz |
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
| 5 | Signed in as Ana (after B1), open **Plan** in the sidebar (its page is titled "Plan y pagos") and click **Elegir un plan** (monthly and yearly) | The same plans, with the same prices before IVA as the public page: Emprende, Negocio and Empresa, monthly and yearly. Gratis is not offered there, since a free plan isn't bought |
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

**Needs:** A1. **Leaves:** Oscar, a super admin with 2FA, signed in to the admin area.

| # | Do | Expect |
|---|---|---|
| 1 | Operator window: register `operator@comprobify.test` and confirm it, as in A1 | Signed in, asked to set up a company. Leave it for now |
| 2 | Visit http://localhost:3000/es/admin | "Página no encontrada": the area isn't advertised |
| 3 | In a terminal: `pnpm super-admin operator@comprobify.test` | "…is now a super admin." |
| 4 | Visit `/es/admin` again | Sent to **Mi cuenta**, asked to turn on two-step verification first |
| 5 | Turn it on: scan the QR with the app, enter a code, save the backup codes | Two-step verification on |
| 6 | Visit `/es/admin` | **Empresas**, the admin area, with its own menu and an **Administración** badge |
| 7 | Sign out and in again | Asked for the authenticator code after the password |

---

## Part B: The company

### B1 · Set up the company

**Needs:** A1. **Leaves:** Comercial Andina, in its test copy (Pruebas).

| # | Do | Expect |
|---|---|---|
| 1 | Owner window: fill the company form with RUC `1712345678001`, Comercial Andina S.A., an address, the main branch `001` Matriz, issue point `001` | Fields check as you go: a RUC with a bad structure is refused. The **Correo de contacto de la empresa** is prefilled with Ana's address: keep it. Under **Avanzado** there is also "Siguiente número de factura": leave 1 here (to start the real company from another number, see K3 or M1) |
| 2 | Upload `test-1712345678001.p12`, password `secret` (or your own file and password) | Accepted. Try once with a wrong password first: refused, clearly |
| 3 | **Crear mi empresa** | The dashboard, "Tu empresa está lista", a yellow "ambiente de pruebas" banner, **SRI Pruebas** in the sidebar |
| 4 | Look at the sidebar | The organization switcher, Pruebas selected; Producción disabled with "Disponible cuando tu empresa pase a producción" |
| 5 | Open the organization switcher and choose **Nueva empresa**. In the form, type RUC `1714070046001` (Andina Norte, which you set up for real later; nothing is created here), any name and address, and upload `test-1790012345001.p12` (it belongs to a different RUC). Don't submit | Refused: the certificate's RUC doesn't match. Leave the form with the browser's back button |

### B2 · The legal documents

**Needs:** B1. **Leaves:** Comercial Andina has accepted the terms.

| # | Do | Expect |
|---|---|---|
| 1 | Dashboard | A blue banner "Acepta los documentos legales" with **Revisar y aceptar** |
| 2 | **Revisar y aceptar** | Three documents (Términos, Privacidad, Acuerdo de Procesamiento de Datos), each **Pendiente** |
| 3 | Open each | The company's own copy: Comercial Andina's name and RUC and the operator's details filled in, no `{{…}}` left |
| 4 | Back: there is one tick per document ("He leído y acepto, en nombre de mi empresa: Términos de Servicio", and the same for the other two). Try **Aceptar** with one left unticked, then tick all three and **Aceptar** | The browser asks for the missing tick; with all three: "Documentos aceptados.", each "Aceptado el …" |
| 5 | Dashboard | The banner is gone |
| 6 | **Actividad** in the sidebar | The acceptance is in the log, with who and when |

### B3 · Company settings

**Needs:** B1. **Leaves:** settings as you made them; one branch and one issue point.

| # | Do | Expect |
|---|---|---|
| 1 | **Empresa** in the sidebar | Tax data, the certificate, branches and issue points |
| 2 | **Editar los datos tributarios**: set **RIMPE Emprendedor**, save; then set it back | Saved each time; the change appears in **Actividad** |
| 3 | In the **Logo** card, choose a PNG (up to 500 KB) and **Subir logo** | "Logo guardado." and "Hay un logo guardado."; on the free plan it says it prints once the plan has Marca. A text file renamed to .png is refused. (It shows on documents after C2, when the plan includes Marca.) |
| 4 | Look at **Agregar establecimiento** and **Agregar punto** | Both are disabled, each with a note: "Tu plan permite 1 establecimiento…" and "…1 punto de emisión por establecimiento…", and a **Ver el plan** button (this changes after C2) |
| 4b | **Editar los datos tributarios**: the **Correo de contacto** shows Ana's address; change it to `ventas@andina.test` and save | Saved; the page shows it. It is where replies to the emails Comprobify sends for the company arrive (G1 and F1) |
| 5 | Open the issue point 001-001's document types | Only Factura is listed, on, and a note says the other types come with their module in Plan |
| 6 | You are in Pruebas: in **Numeración de pruebas**, set the next number of 001-001 Factura to `50` and **Guardar numeración**; then try `10` | "Numeración guardada.", the field keeps 50. A number below the current one is stopped by the field, and if forced, refused: a sequential only moves forward. **Actividad** shows the change. This is the test copy's own numbering; the real company's is set at go-live (M1), or from this card while in Producción |

### B4 · What the free plan includes

**Needs:** B1. **Leaves:** nothing new.

| # | Do | Expect |
|---|---|---|
| 1 | **Plan** in the sidebar | Gratis, its modules and limits (5 documents, 1 user, 1 branch), and **Elegir un plan** |
| 2 | Look at the sidebar, then type these addresses in the browser one by one: `/es/inventory`, `/es/purchase-orders`, `/es/sale-orders`, `/es/bulk-invoicing` | The sidebar doesn't list Inventario, Órdenes de compra, Pedidos de venta or Facturación masiva, since the plan lacks them. Each address shows a lock: "tu plan no incluye…", with a link to the plan |
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
| 5 | Operator window, admin area | A **1** on the bell; "Hay un pago por revisar" with Comercial Andina and $91,89; a `paymentReported` email in the terminal |
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
| 7 | **Empresa** → the issue point `001-001` → **Tipos de comprobante**: tick **Nota de crédito** and **Guía de remisión**, save; the same for Norte's `002-001` | Saved. A plan that gains a module doesn't turn its document types on by itself: F4 and F5 need these |

### C3 · The operator invoices the payment

**Needs:** C2. **Leaves:** the operator's company with one invoice; the payment invoiced.

| # | Do | Expect |
|---|---|---|
| 1 | Operator window: the person icon at the bottom of the admin sidebar (**Mi cuenta**, or `/es/account`) → **Configurar mi empresa**: RUC `1790012345001`, Comprobify Operadora S.A., `test-1790012345001.p12` | The company, in its test copy, beside the admin area |
| 2 | In it, create a client: Comercial Andina, with the company's RUC (`1712345678001`, or yours) | Created |
| 3 | **Nueva factura** for that client: one line with code `PLAN-EMP`, description "Plan Empresa, mensual", 1 × 79,90, IVA 15 %, paid by transfer. First leave the code empty and press **Emitir factura** | "Falta el código de la línea 1…" on the form, and the cursor goes to the field. With the code: total $91,89; **Emitir factura** → authorized by the mock SRI within seconds |
| 4 | Copy the invoice's 49-digit access key from its page | |
| 5 | Admin area → **Por facturar** | Comercial Andina's payment, with **Registrar factura** and **Sin factura** |
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
| 8 | Buy another pack, choose **Tarjeta**, then go back to **Transferencia** and cancel the payment | It asks first; the payment is "Cancelado" and nothing is charged. A decline can't be provoked here (Payphone publishes no declined test card and its widget refuses a wrong card before submitting); it is covered by the integration tests against a fake Payphone (`payphone.test.ts`) |

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
| 5 | Type "caf" in the search box, without pressing anything | The list narrows by itself after a short pause to Café molido only, the cursor stays in the box, the address gets `?q=caf`, and a ✕ clears it. Then try the **Estado** filter (Activos / Inactivos / Todos), the **Tipo** filter (Bienes / Servicios) and clicking the **Nombre** and **Precio** headers: each applies at once, the header shows its arrow, and clicking it again reverses the order |
| 6 | Deactivate SRV-1, then reactivate it | Each asks first; the badge changes |

### D2 · Clients

**Needs:** D1. **Leaves:** María Pérez and Distribuidora Sur.

| # | Do | Expect |
|---|---|---|
| 1 | **Clientes** → **Nuevo cliente**: cédula `1710034066` | Refused: the check digit is wrong |
| 2 | María Pérez, cédula `1710034065`, `maria@cliente.test`, 30 days of credit | Created |
| 3 | Distribuidora Sur S.A., RUC `0992339411001`, `compras@sur.test` | Created |
| 4 | Edit María's phone | Saved |
| 5 | Type "mar" in the search box, then choose the identification type **Cédula**, then the state **Inactivos**, then click the **Identificación** header | Each applies at once. "mar" shows María only; Cédula keeps María; Inactivos shows "Sin resultados"; the header sorts by identification and shows its arrow |

### D3 · Providers

**Needs:** C2. **Leaves:** Importadora Andes.

| # | Do | Expect |
|---|---|---|
| 1 | **Proveedores** → **Nuevo proveedor**: Importadora Andes S.A., RUC `1710104257001`, `ventas@andes.test` | Created |
| 2 | Edit and save | Saved |
| 3 | Type "andes" in the search box; try **Estado** and click the **Nombre** header | The same behavior as in Clientes: applies at once, nothing to press |

### D4 · Products and clients by CSV

**Needs:** D1, D2. **Leaves:** a few more products and one more client.

| # | Do | Expect |
|---|---|---|
| 1 | **Productos** → **Exportar CSV**, open it in Excel | One row per product, Spanish headers, `;` columns and decimal commas, "si"/"no" |
| 2 | **Importar CSV** → **Descargar plantilla**, open it | The file is named `plantilla-productos.csv` (the export in step 1 is `productos.csv`); a header and two example rows, `EJ-1` and `EJ-2`, named "…(reemplaza esta línea)", so importing it unchanged can't touch the products you made |
| 3 | Make a file with the header from the template and three rows, so the rows are lines 2, 3 and 4: line 2 `AZU-1` Azúcar (bien, 1,10, IVA 4); line 3 `BAD-1` with IVA `99`; line 4 `AZU-1` again, repeated inside the file | The file is ready: one good row, one with a wrong IVA, one repeating a code from the same file |
| 4 | Import it | "2 líneas tienen problemas; no se importó nada." An import is all or nothing, so even the good first row (AZU-1) is not saved. Line 3: "revisa la columna «IVA»"; line 4: "el código ya aparece antes en el archivo" (meaning earlier in this same file, not in the catalogue) |
| 5 | Remove the two bad rows, import again (save the file from Excel as plain "CSV" or as "CSV UTF-8": either works) | "Se creó 1 producto." Azúcar listed with its accent intact |
| 6 | Import the export from step 1, unchanged | Updated, none created, nothing changed |
| 7 | **Clientes** → **Importar CSV** with: `05;1700000001;Pedro Ruiz;pedro@cliente.test` (and the header from the template) | "Se creó 1 cliente." |
| 8 | Change CAF-1's price in a CSV to 6,00 and import | CAF-1 updated to $6,00; set it back to 5,50 the same way |

---

## Part E: Inventory

### E1 · Opening balances

**Needs:** D1, C2 step 6 (the Norte branch). **Leaves:** in Matriz CAF-1 50 kg at $2,25 and TE-1 30 at $1,40; in Norte CAF-1 20 at $2,00.

| # | Do | Expect |
|---|---|---|
| 1 | **Inventario** | The stocked products at zero, one row per warehouse (Matriz, Norte) |
| 2 | CAF-1 → **Registrar saldo inicial**: Matriz, 50, cost 2,25 | On hand 50, average cost 2,25 |
| 2b | CAF-1 → **Registrar saldo inicial** again | The **Almacén** choice is there and lists only Norte, since Matriz already has its balance. Set Norte to 20 at cost 2,00; CAF-1 shows Matriz 50 and Norte 20. (Norte exists once the branch `002` of C2 step 6 is created; without it there is only Matriz and no choice to make) |
| 3 | **Importar saldos iniciales** with a file: `TE-1;001;30;1,40` and `CAF-1;001;10;2,00` | Refused, line 3: CAF-1 already has movements in that warehouse |
| 4 | Remove the CAF-1 line (open the file in Excel, delete the row, save as "CSV UTF-8") and import | "Se importó 1 saldo inicial."; TE-1 at 30. A file Excel saved with each line as one quoted cell is read too |
| 5 | Type "te" in the search box, then choose a warehouse | Each applies at once, with no button, and the cursor stays in the box |

### E2 · Adjustments

**Needs:** E1. **Leaves:** CAF-1 at 48 in Matriz and 20 in Norte.

| # | Do | Expect |
|---|---|---|
| 1 | CAF-1 → **Ajustar existencias**: warehouse **Matriz**, out 2, reason "Merma" | Matriz 48 on hand (Norte still 20); a movement "Salida" with the reason |
| 2 | Same, Matriz, out 1000 | Refused: not enough stock |
| 2b | Warehouse **Norte**, out 25 | Refused: Norte has only 20, even though the product has 68 in all |
| 3 | **Empresa** → turn on **Permitir existencias negativas**, then off again | Saved each time |

### E3 · Valuation and the nightly check

**Needs:** E2. **Leaves:** CAF-1 at 47 in Matriz.

| # | Do | Expect |
|---|---|---|
| 1 | **Inventario** → valuation | Each product's quantity, average cost and value, by warehouse; the total (CAF-1 in both Matriz and Norte) |
| 2 | Download its CSV and open it in Excel | The same quantities, costs and values as on the screen, by warehouse, with accents intact |
| 2b | **Al día**: pick yesterday, then a day before the first movement | Yesterday's figures (today's changes left out); then nothing. The CSV's name carries the day |
| 2c | **Importar un conteo**: download the template, put CAF-1 with Matriz 47 and Norte 20, reason "Conteo físico QA" | "Se hizo 1 ajuste; 1 sin cambios." Matriz 47 with a "Salida" of 1 and the reason; **Actividad** → Operaciones: "importó un conteo físico". A line with a code that doesn't exist refuses the whole file |
| 3 | `pnpm run-job inventory.verify` | The command only queues the job ("Queued inventory.verify …; the worker runs it next"). Look in the terminal where `pnpm dev` runs, the worker's output: within seconds a line "Checked N stock levels, 0 with drift" (N is the products times their warehouses). A line "A stock level differs from its ledger" would be a problem |

---

## Part F: Documents

### F1 · An invoice, from the keyboard

**Needs:** D2, E1. **Leaves:** one authorized invoice to María (A).

| # | Do | Expect |
|---|---|---|
| 1 | **Comprobantes** → **Nueva factura** | The form, the issue point preselected |
| 2 | Find María by typing "Mar" and pressing Enter; add CAF-1 × 2 and SRV-1 × 1 using the keyboard only | Totals update as you type: base 41,00, IVA 6,15, total 47,15 |
| 3 | Payment: transfer, 47,15 | Payments match the total |
| 4 | **Emitir factura** → confirm | The invoice page; within seconds "Autorizado", the authorization number, a timeline of events. The number is `001-001-000000050`, the test numbering set in B3 step 6. The page has a **Cobros** section saying "Aún no se registra ningún cobro" and the balance owed: the payment of step 3 is the invoice's *forma de pago*, which goes to SRI; a **cobro** is money actually received, recorded later (H3) |
| 5 | **Ver PDF** (the RIDE) | The RIDE with the logo from B3, the lines and the access key |
| 6 | The XML link | The authorized XML |
| 7 | Terminal | A buyer email to `maria@cliente.test` with the RIDE and XML attached, Reply-To `ventas@andina.test`, and a footer saying the sender address receives no messages and to write to that address |
| 8 | **Inventario** → CAF-1 | Matriz 46 on hand (the invoice left from Matriz, the warehouse of issue point 001-001); Norte still 20; a "Venta" movement for the invoice |

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

**Needs:** F1, and C2 step 7 (Nota de crédito enabled on the issue point; without it the page says "No tienes un punto de emisión habilitado para notas de crédito"). **Leaves:** a credit note for part of invoice A.

| # | Do | Expect |
|---|---|---|
| 1 | Invoice A → **Nota de crédito** | A form with A's lines and what can still be credited |
| 2 | Credit CAF-1 × 1, tick **Devolver los productos al inventario**, a reason | **Emitir nota de crédito** → authorized |
| 3 | Invoice A and the note | Each links to the other |
| 4 | **Inventario** → CAF-1 | Matriz 47: one came back there; Norte still 20 |
| 5 | Try to credit more than is left on A | Refused |

### F5 · A guía de remisión

**Needs:** F1, and C2 step 7 (Guía de remisión enabled on the issue point). **Leaves:** a guía for invoice A.

| # | Do | Expect |
|---|---|---|
| 1 | Invoice A → **Guía de remisión** | The invoice's lines, a carrier and dates to fill |
| 2 | Carrier name and identification, plate **ABC-1234**, start and end dates | **Emitir guía de remisión** → authorized |
| 3 | Its RIDE | The transport section |

### F6 · Void an invoice

**Needs:** F2, F3. **Leaves:** one invoice to María voided.

| # | Do | Expect |
|---|---|---|
| 1 | Open the consumidor final invoice of F2 | No **Marcar como anulada** button: a consumidor final invoice can't be voided, and can't take a credit note either |
| 2 | Issue a new invoice to María Pérez: TE-1 × 1 | Authorized; **Inventario** shows TE-1 Matriz 24 (30, less the 5 of F2 and this 1) |
| 3 | Open it → **Marcar como anulada** | It asks for confirmation, shows the deadline (the 7th of next month), and explains that you void it on SRI's site first |
| 4 | Confirm | The mock SRI says it's voided; the invoice shows "Anulado"; **Inventario** TE-1 back to 25 |

### F7 · Finding documents

**Needs:** F1–F6. **Leaves:** nothing new.

| # | Do | Expect |
|---|---|---|
| 1 | **Comprobantes** | Every document above, newest first, with status badges |
| 2 | Filter by status, by issue point, by dates; search by a number and by an access key | Each applies as you type or choose, with no button; **Limpiar** brings it back |
| 3 | On **Comprobantes**, open **Pendientes** | The documents that have no final answer from SRI yet, in two groups: "Necesitan que los corrijas o re-emitas" (returned, not authorized, or not sent) and "Esperando al SRI" (sent, answer awaited). Locally the mock SRI answers at once, so you should see "Nada pendiente — Todos los comprobantes tienen ya una respuesta final del SRI" |

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
| 4 | **Enviar la orden por correo** to `ventas@andes.test` | Sent; the order is no longer a draft; an email "Orden de compra OC-… — Comercial Andina S.A." with the PDF, from "Comercial Andina S.A. via Comprobify" with **Reply-To** `ventas@andina.test`, the contact email set in B3 step 4b (check in the email's headers; without a contact email it would be the sender's own address). Its last line asks the provider to reply to confirm that it received the order and when it can deliver, and the footer says the sender address receives no messages and to write to `ventas@andina.test` |
| 5 | Back in **Órdenes de compra**, type the order number or "andes", then choose a status | The list follows at once, no button |

### G2 · Receive it in parts

**Needs:** G1. **Leaves:** CAF-1 and TE-1 stocked from the order.

| # | Do | Expect |
|---|---|---|
| 1 | **Recibir mercadería**: CAF-1 × 10 now | "Parcialmente recibida"; CAF-1 up by 10 in Matriz (the order's warehouse), its average cost recalculated; Norte unchanged |
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
| 1 | **Pedidos de venta** → **Nuevo pedido**: Distribuidora Sur, warehouse **Matriz**, CAF-1 × 10 | **Guardar borrador** |
| 2 | **Confirmar pedido** | Confirmed; **Inventario** shows 10 CAF-1 reserved in Matriz, its available down by 10 (Norte's untouched) |
| 3 | A second order, TE-1 × 2, confirm it, then **Anular pedido** | The reservation is released |

### H2 · Invoice the order in parts

**Needs:** H1. **Leaves:** PV-000001 invoiced in two invoices, closed.

| # | Do | Expect |
|---|---|---|
| 1 | PV-000001 → invoice it: 4 now, payment on credit (30 days). Look at the **Punto de emisión** choice | Only the issue points of the order's warehouse branch (`001-001` for Matriz): Norte's isn't offered. An authorized invoice; the order "Parcialmente facturado" |
| 2 | Invoice the remaining 6, with **Agregar forma de pago**: 10,00 by transfer, the rest in cash | The first payment shows "El resto del total" and follows the lines; typing more than the total in the second says to lower it. "Facturado"; the reservation is gone, stock went down by 10 in all; the invoice shows both payments |
| 3 | Each invoice | Links back to the order |

### H3 · Collect and the aging report

**Needs:** H2, F1. **Leaves:** Distribuidora Sur's first invoice (25,30) partly collected, its second (37,95) untouched.

The two invoices of H2 are 4 × CAF-1 = 22,00 + IVA 3,30 = **25,30**, and 6 × CAF-1 = 33,00 + IVA 4,95 = **37,95**, both on 30 days of credit. A *cobro* is money you actually received for an invoice, recorded by hand; the **Cobros** card on an invoice's page holds it.

| # | Do | Expect |
|---|---|---|
| 1 | **Cuentas por cobrar** (sidebar) | The title and "al <today>"; a summary by age: **Por vencer**, **1 a 30 días**, **31 a 60 días**, **61 a 90 días**, **Más de 90 días**, each with its count and total; today everything is in **Por vencer** (30 days of credit). Under it the list: Factura, Cliente, Vence, Atraso, Total, Saldo, with Distribuidora Sur's two (25,30 and 37,95, balance equal to total), María's invoice from F1, and the others still owed; **Total por cobrar** adds the balances |
| 2 | Open Distribuidora Sur's 25,30 invoice | A **Cobros** card: "Sin cobrar", "Vence el <date, 30 days out>"; rows Total de la factura 25,30, Cobrado 0,00, **Saldo 25,30**; "Aún no se registra ningún cobro."; a **Registrar cobro** button |
| 3 | **Registrar cobro**: value `15,00`, date today, method any (for example Transferencia), reference `TR-001` | "Cobro registrado." The card now says "**Cobro parcial**"; Cobrado 15,00, **Saldo 10,30**; the payment is listed with its date, method, reference and 15,00 |
| 4 | **Cuentas por cobrar** again | The invoice is still listed, with Saldo 10,30 (Total 25,30); **Total por cobrar** went down by 15,00 |
| 5 | Back on the invoice: **Registrar cobro** with `20,00` | Refused: "El cobro supera lo que se debe…" (the dialog suggests 10,30, the balance) |
| 6 | **Registrar cobro** with a date in the future, then with `0` | The date picker does not allow a day after today (it is disabled), which is right. A value of `0`: the dialog says "Revisa los datos: el valor debe ser mayor que cero, con hasta 2 decimales." Close the dialog with **Cancelar** and open it again: that message is gone and the value is back to 10,30 |
| 7 | **Registrar cobro** for the rest: `10,30`, today, **Efectivo**, no reference | The card says "**Cobrada**"; Saldo 0,00; the **Registrar cobro** button is gone; two payments listed |
| 8 | **Cuentas por cobrar** | The invoice has left the list; **Total por cobrar** is lower by 10,30 |
| 9 | On the invoice, the 🚫 button of the **second** payment (10,30) → reason `Se registró dos veces` → **Anular cobro** | It asks first. "Cobro anulado."; that payment stays in the list with an **Anulado** badge, its reason and its value struck through; Cobrado 15,00, **Saldo 10,30** again; status "Cobro parcial"; **Registrar cobro** is back |
| 10 | **Cuentas por cobrar** | The invoice is back in the list with Saldo 10,30 |
| 11 | **Descargar CSV** on the report, open it in Excel | One row per open invoice with the same figures as the screen (including 25,30 / 10,30), accents intact |
| 12 | **Actividad** → **Operaciones** | One line per cobro: "Ana Pérez registró un cobro de la factura 001-001-…: $15,00 · Transferencia", "…registró un cobro…: $10,30 · Efectivo" and "…anuló un cobro de la factura…: $10,30 · Se registró dos veces", each with its time |

Overdue buckets (1 a 30 días and beyond) can't be reached locally without moving dates, so they are covered by the automated tests (`receivables.test.ts`).

---

## Part I: Bulk invoicing

### I1 · From sale orders

**Needs:** H1. **Leaves:** one batch, completed.

| # | Do | Expect |
|---|---|---|
| 1 | Create and confirm two sale orders: María CAF-1 × 1, Distribuidora Sur TE-1 × 1 | Confirmed |
| 2 | **Facturación masiva** → **Nueva facturación masiva** | The orders held in the chosen issue point's warehouse (the hint under **Punto de emisión** says so), an issue point and a payment method. Choose `002-001` Norte: the list changes to the orders held in Norte (none, if all were made in Matriz) or says there are none, and the issue point stays selectable. Choose `001-001` again: both orders are back. A batch can't mix warehouses, so orders of Matriz and of Norte go in two batches |
| 3 | Tick both → **Facturar 2 pedidos** → confirm | The batch page: items queued, then made, then authorized, live |
| 4 | Wait for it to finish (a minute) | "Completado"; the bell: "Terminó un lote de facturas" |
| 5 | Admin area (operator) → **Cola de facturación** while one runs | The company with its items in flight |
| 6 | On the finished batch, open an invoice, then press **Volver** (top left); then open an order from the batch and press it again | Each returns to **Lote de facturación**, not to Comprobantes or Pedidos de venta. The same holds from the Pendientes list and Cuentas por cobrar (back to that list, with its filters) and from an invoice's sale order (back to the invoice) |

### I2 · From a CSV

**Needs:** D1, D2, I1. **Leaves:** a CSV batch with two invoices.

A CSV batch makes invoices from a spreadsheet instead of from sale orders. Each row is one **line**; rows that share the same **referencia** become **one invoice** with several lines. The columns are:

| Column | What it is |
|---|---|
| `referencia` | Any label you choose, such as `X-1`. Rows with the same one are the lines of one invoice |
| `cliente` | The client's identification (cédula or RUC) of a client you already have. Empty means consumidor final |
| `producto` | The product's code, as in **Productos** |
| `cantidad` | How many |
| `precio` | The unit price before IVA. Empty takes the product's price |
| `descuento` | A discount, or empty for none |

| # | Do | Expect |
|---|---|---|
| 1 | **Facturación masiva** → **Importar CSV** → **Descargar plantilla**, open it | `plantilla-facturas.csv` with the header `referencia;cliente;producto;cantidad;precio;descuento` and example rows where two rows share a reference |
| 2 | Make your own file with that header and these four rows (save it as "CSV UTF-8", or type them in a text editor and save as `.csv`):<br>`referencia;cliente;producto;cantidad;precio;descuento`<br>`X-1;1710034065;CAF-1;2;;`<br>`X-1;1710034065;TE-1;1;;`<br>`X-2;;CAF-1;1;5,00;`<br>`X-3;;NO-EXISTE;1;;`<br>It means: invoice **X-1** to María Pérez with 2 × CAF-1 and 1 × TE-1 at their usual prices; invoice **X-2** to consumidor final with 1 × CAF-1 at 5,00; and **X-3** with a product that does not exist, on purpose | The file is ready: three invoices' worth of rows, one of them wrong |
| 3 | On the import page, choose the issue point `001-001` and a payment method, attach the file and press **Revisar y facturar** | Nothing starts. It lists the problem: "Línea 5: no existe un producto con ese código" (line 5 is the X-3 row, the header being line 1) |
| 4 | Remove the X-3 row from the file, attach it again and **Revisar y facturar** | The batch page opens with two invoices, X-1 and X-2, queued and then made by the worker, as in I1; "Completado" within a minute |
| 5 | Open X-1's invoice | Two lines (CAF-1 × 2 and TE-1 × 1), to María Pérez, total $16,33 (14,20 + IVA 15 %) |
| 6 | Open X-2's invoice | One line, CAF-1 × 1 at 5,00, to consumidor final, total $5,75 |
| 7 | **Inventario** | CAF-1 in Matriz down by 3 and TE-1 down by 1, since the batch's issue point is Matriz's |

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
| 5 | **Invitar** another address as Ventas and tick only `001-001`, send it. Before accepting, look at the list | The pending row shows `001-001` under **Puntos de emisión**. Administrador has no list in the dialog (it always sees every point); the others start with none ticked, which means all of them |
| 6 | Accept that invitation in a private window and open the invoice form | Only `001-001` is offered, in the test copy too. **Actividad** → the invitation line is there; the limit can be changed later from **Editar** (J3) |

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
| 1 | Owner: for a member invited without a limit, **Editar** and tick issue point **001-001** (Víctor, Ventas, if you made one) | Víctor's invoice form offers only that one. Unticking all of them lifts the limit |
| 2 | Change Bruno from Compras y bodega to Ventas, then back | His menu changes after a reload |
| 3 | Remove Lucía (**Quitar**) | It asks first. In her open window, reloading takes her to the page to create a company of her own (her account is still hers and has no company now), not to Comercial Andina; she can't open it again, in Pruebas or Producción, and the owner's **Usuarios** no longer lists her |
| 4 | **Actividad** | Each of these, with who did it |

### J4 · Two-step verification for everyone

**Needs:** J1. **Leaves:** 2FA required in Comercial Andina.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: **Mi cuenta** → turn on two-step verification | On, with backup codes |
| 2 | **Usuarios** → **Exigir verificación en dos pasos a todos los miembros** | Saved |
| 3 | Adela (Administrador) signs in | Sent to set it up before she can work |
| 4 | Owner: sign out, sign in, and at the code tick **Recordar este dispositivo por 30 días** | In. Sign out and in again: no code asked, only the password. In a private window the code is still asked |
| 5 | **Mi cuenta** → **Cerrar sesión en todos los dispositivos**, then sign in again | The code is asked again |
| 6 | Operator (super admin): sign in | No "Recordar este dispositivo" box; the code every time |
| 7 | Owner: **Empresa** → **Sesiones** → 5 minutes. Leave the tab untouched for 6 minutes, then click | Back to the sign-in page: "Tu sesión se cerró por inactividad." Set it back to 30 minutes |

---

## Part K: Notifications

### K1 · The bell and preferences

**Needs:** C2, F1, I1. **Leaves:** notices read.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: the bell | The notices so far: payment confirmed, batch finished, newest first, unread marked |
| 2 | Click one | Goes where it's about, and it's marked read |
| 2b | Switch between **Producción** and **Pruebas** (after M1) | In Producción the bell and **Notificaciones** show only production's notices; Pruebas shows those and the test ones, each marked "Pruebas" |
| 3 | Sidebar → **Notificaciones** (under Administrar, for every role; **Ver todas** in the bell goes to the same page) → **Sin leer**, **Marcar todas como leídas** | The list empties |
| 4 | The preferences | One row per type the owner receives, in-app and email; "Cambio de precio" locked on (mandatory) |
| 5 | Víctor (Ventas): **Notificaciones** | Document types only; no billing types |

### K2 · Authorizations, grouped

**Needs:** K1. **Leaves:** "Documentos autorizados" on for the owner.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: turn on **Documentos autorizados** (in the app) | Saved; it's off by default |
| 2 | Issue two invoices within a minute | One notice: "Se autorizaron 2 documentos"; opening it goes to the **Comprobantes** list (a notice for one document opens that document) |
| 3 | Wait a minute, issue another | A new notice with 1 |

### K3 · The certificate about to expire

**Needs:** A1. **Leaves:** Andina Norte, a second company with a short-lived signature.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: the organization switcher → **Nueva empresa** (also on **Mi cuenta**): RUC `1714070046001`, Andina Norte S.A., `test-1714070046001.p12`; under **Avanzado**, set "Siguiente número de factura" to `300` | Andina Norte's dashboard, in its test copy; the switcher lists both, with their RUCs |
| 2 | Its dashboard | The certificate card: "Por vencer", the date 10 days out; a certificate banner |
| 3 | `pnpm run-job certificates.watch` | The bell in Andina Norte: "Tu firma electrónica vence pronto", 10 days; a `certificateExpiring` email in the terminal |
| 4 | Andina Norte → **Pasar a producción** (don't submit) | The numbering field for Factura on 001-001 shows `300`, the number given when the company was created; its test copy numbering in **Empresa** is still 1 | Without ticking "Entiendo que este paso no se puede deshacer", **Pasar a producción** answers in red "Marca la casilla para confirmar." (and with the legal texts on, "Primero acepta los documentos legales…" until the owner accepts them in **Documentos legales**)
| 5 | Run `pnpm run-job certificates.watch` a second time | No second notice in the bell and no second `certificateExpiring` email: each reminder is told once per signature and step |
| 5b | Notice link → **Empresa** → **Firma electrónica** | "Vence el …: quedan 10 días". Upload `test-1714070046001.p12` with a wrong password: "La contraseña de la firma no es correcta."; a file of another RUC: "La firma no pertenece al RUC de esta empresa.". With `pnpm test-certificate 1714070046001 365`, upload that: "Firma reemplazada.", the card says "Vigente hasta …", the certificate banner is gone (also in the test copy). **Actividad** shows the upload. Run `pnpm run-job certificates.watch`: no new notice |
| 6 | Switch back to Comercial Andina | Its own notices only |
| 7 | Open an invoice of Comercial Andina, then switch to Andina Norte (and again with the Pruebas / Producción toggle) | You land on the **Comprobantes** list of the company you switched to, not on "Página no encontrada". The same goes for an order, a batch or a product's stock. On a real 404, **Volver al panel** opens the dashboard |

---

## Part L: Dashboard and reports

### L1 · The dashboard

**Needs:** D to I. **Leaves:** nothing new.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: **Panel** | Sales today and this month, which you can check against the invoices you issued; in progress and with problems; documents by status; top sellers; out of stock; documents this period; the signature |
| 2 | Click a status | The document list filtered by it. On **Comprobantes**, click the headers **Número**, **Fecha**, **Comprador**, **Total** and **Estado**: the list reorders, a second click reverses it, the arrow shows which, and the filters and search stay |
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
| 7 | **Descargar CSV** on each | Opens in Excel, the same rows. The file is named in the language of the screen: `reporte-ventas-2026-11-01_2026-11-30.csv` in Spanish, `report-sales-…` in English (switch the language and download again) |

### L3 · The accountant's export

**Needs:** J1, F1–F6. **Leaves:** nothing new.

| # | Do | Expect |
|---|---|---|
| 1 | Carla (Contador): **Reportes** → **Exportación para el contador**, this month, with "Incluir el PDF (RIDE)" ticked, **Descargar ZIP** | A `comprobantes-AAAA-MM.zip` |
| 2 | Open it | `autorizados/` with one XML and one PDF (the RIDE) per authorized document, `anulados/` with the voided invoice's. Open a PDF: it is the same RIDE as on the invoice's page. Download again with the box unticked: XML only |
| 3 | A month with nothing, e.g. 2020-01 | "No hay comprobantes autorizados en 2020-01." |

### L4 · The activity log: account and operations

**Needs:** B3, D1–D4, E1–E3, F6, G3, H3, J1. **Leaves:** nothing new. Work in the test copy (Pruebas), where the earlier flows were done: what the business does is recorded in the company in use, so the real company's log stays empty until you work there.

The log has two categories (ADR-041): **Cuenta y configuración** (who signed in, people and roles, settings, certificate, plan and payments) and **Operaciones** (what the business did).

| # | Do | Expect |
|---|---|---|
| 1 | Ana (Propietario): **Actividad** | Three tabs: **Todo**, **Cuenta y configuración**, **Operaciones**; above them **Todos los usuarios** / **Solo mi actividad**. "Todo" mixes both, newest first. **Solo mi actividad** keeps only Ana's own lines, in the tab you are on |
| 2 | **Cuenta y configuración** | Sign-ins, the company's creation, the legal texts accepted, settings and role changes, plan and payments; no products, stock or invoices |
| 3 | **Operaciones** | The business's own acts, each "Ana Pérez … <what>: <detail>" with its time. Look for the ones below |
| 4 | Look for the products you made and changed | "creó el producto: CAF-1 · Café molido"; "cambió el producto: CAF-1 · Café molido · precio de 5.500000 a 6.000000" (D4 step 8, and back to 5.50); "cambió el estado del producto: SRV-1 …: desactivado" then "activado" (D1 step 6); "importó productos: 1 creado" (D4) |
| 5 | Look for clients and providers | "creó el cliente: 1710034065 · María Pérez"; "cambió el cliente: … cambió teléfono" (D2 step 4: the field's name, never the number); "creó el proveedor …" |
| 6 | Look for stock | "registró un saldo inicial de: CAF-1 · Matriz · 50 × $2.25"; "importó saldos iniciales: 1 saldo"; "ajustó las existencias de: CAF-1 · Matriz · salida 2 · Merma" (E2) |
| 7 | Look for orders and the invoice that was voided | "anuló la orden de compra: OC-… · Ya no se necesita" (G3); "anuló el pedido de venta: PV-…" (H1 step 3); "facturó el pedido de venta: PV-000001 · factura 001-001-…" (H2); "marcó como anulada la factura: 001-001-…" (F6) |
| 8 | Look for collections | "registró un cobro de la factura …: $15,00 · …" and "anuló un cobro de la factura …" (H3) |
| 9 | Look for data taken out | "descargó datos: clientes", "…: productos", "…: valoración de inventario" (E3), "…: reporte …" if you downloaded one (L2) and "…: comprobantes del mes (ZIP del contador)" after L3 |
| 10 | Víctor (Ventas) and a Solo lectura member: **Actividad** (it is in everyone's sidebar) | "Lo que has hecho tú en esta empresa": only their own lines (signing in, what they issued or changed), no tabs and no other person's. Carla (Contador) sees every operation and can switch to **Solo mi actividad** |
| 10 | Switch to **Producción** (the switcher) and open **Actividad** → **Operaciones** | Empty ("Todavía no hay operaciones registradas."): the test copy's acts are not the real company's. Go back to **Pruebas** |
| 11 | Carla (Contador): **Actividad** | No tabs: she sees only **Operaciones** (what the business did), not who signed in or changed roles. Opening `/es/audit?category=ACCOUNT` shows the same operations, not the account's events |
| 12 | Bruno (Compras y bodega) and Lucía (Solo lectura) | No **Actividad** in their menu |
| 13 | As Ana, try to change an entry | There is no way to: the log has no edit or delete, and the page says so |

---

## Part M: Going live

### M1 · Take the company to production

**Needs:** B2, D1–D3. **Leaves:** Comercial Andina live.

| # | Do | Expect |
|---|---|---|
| 1 | Owner: **Pasar a producción** (dashboard) | A page: the next number for each issue point and document, showing `1` for Factura on 001-001 (the real company's own numbering, not the test copy's 50), and "Llevar tus datos de pruebas" ticked |
| 2 | Set Factura on 001-001 to start at **101** (a number below the current one is refused); tick "Entiendo que este paso no se puede deshacer"; **Pasar a producción** | "Tu empresa está en producción", **SRI Producción** in the sidebar, no "Estás en el ambiente de pruebas" banner. Locally (and on staging) a yellow "Sistema local: no es producción" banner stays, since only the real production system sends to SRI's production side |
| 3 | **Productos**, **Clientes**, **Proveedores** | The test copy's ones came along; documents and stock did not |
| 4 | The switcher: **Pruebas** | The test copy, its documents still there; switch back to **Producción** |
| 5 | **Actividad** | "pasó la empresa a producción" |

### M2 · The first production invoice

**Needs:** M1. **Leaves:** one production invoice, 001-001-000000101.

| # | Do | Expect |
|---|---|---|
| 1 | **Nueva factura** to María, SRV-1 × 1 | Number **001-001-000000101**, authorized (still the mock SRI, locally) |
| 2 | Its RIDE and the buyer's email in the terminal | Locally both say PRUEBAS, because only the production system uses SRI's production environment (FR-ONB-6); the email's subject also starts with **[LOCAL]** and says so in its first line, so it can't be taken for a test copy's. On the real production system: no PRUEBAS mark, no environment mark |

### M3 · The quota fills up

**Needs:** M2, C4 (the pack). **Leaves:** the quota used, a pack partly spent.

| # | Do | Expect |
|---|---|---|
| 1 | Operator: **Empresas** → Comercial Andina → add an exception: **DOCUMENT_QUOTA** = 5, reason "Prueba QA" | Saved. A reason of fewer than 3 characters says "Escribe al menos 3 caracteres." under the field |
| 2 | Owner: issue invoices until 4 production documents exist this period | |
| 3 | `pnpm run-job quota.watch` | The bell: "Se acerca el límite de documentos", 80 % of 5; an email |
| 4 | Issue the 5th, run it again | "Llegaste al límite de documentos" |
| 5 | Issue a 6th | It goes through, spending one document from the pack bought in C4; **Plan** shows the pack one less, and Límites reads "5 de 5 + 1 de tus paquetes", never "6 de 5" |
| 6 | Operator: remove the exception | The plan's 2000 again: **Plan** shows the quota as "2.000" and the count "6 de 2.000". The pack keeps the one document the 6th invoice already spent (a spent document is not given back) |
| 7 | Issue another invoice | The pack does not go down this time: the 7th counts against the plan's 2000 ("7 de 2.000") |

The test copy never uses quota: invoices in Pruebas don't count.

### M4 · Reset the test copy

**Needs:** M1. **Leaves:** the test copy empty, with the company's master data, numbering from 1.

| # | Do | Expect |
|---|---|---|
| 1 | As the accountant | No **Empresa** in the menu, so no way to reset (only the owner and admins have it) |
| 2 | As the owner, in the test copy: **Empresa** → **Restablecer la copia de pruebas**, type a wrong RUC | "El RUC no coincide." Nothing changes |
| 3 | Type the RUC | "La copia de pruebas se restableció." Comprobantes, pedidos and inventory of the test copy are empty; Productos and Clientes hold the company's; the production company is unchanged |
| 4 | Issue an invoice in the test copy | Number `001-001-000000001` |
| 5 | **Actividad** | "restableció la copia de pruebas" |

### M5 · Hand the company over, and back

**Needs:** J1. **Leaves:** the owner as before.

| # | Do | Expect |
|---|---|---|
| 1 | As an admin: **Usuarios** | No crown button on anyone |
| 2 | As the owner: the crown beside the admin → type a wrong email | "El correo no coincide." Nothing changes |
| 3 | Type the admin's email | "La empresa tiene un nuevo propietario." The admin shows as Propietario, you as Administrador, in Producción and Pruebas; **Pasar a producción** and the crowns are gone for you |
| 4 | As the new owner, transfer it back | As before. **Actividad** lists both transfers |

---

## Part N: The admin area

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

### N6 · The admin log

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
