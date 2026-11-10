# Payphone test card run

The last part of the Milestone 8 gate, run by the owner: a real card payment through Payphone's test environment, end to end. Everything else about cards is covered by the integration tests against a fake Payphone (ADR-033). This run proves what only Payphone can:

- its widget loads on our domain;
- the token and store id work;
- the amounts in cents pass its checks;
- the confirm call reaches its server and approves.

Payphone's credentials stay in your own `.env`. Never commit them or paste them anywhere.

## Before

1. **Credentials.** In Payphone's developer console, use the test application. You need its token and its store id.
2. **The domain.** Register the address the app runs on. The widget only renders on a registered domain, so if `localhost` can't be registered, run this on a deployed staging address instead.
3. **The return address.** Register `<address>/es/plan/card-return`. Payphone sends the payer there when the widget finishes.
4. **The app.** Set the following in `.env` and restart `pnpm dev`, or the stack:
   - `PAYPHONE_TOKEN` and `PAYPHONE_STORE_ID`, both together;
   - `APP_ENV` must not be `production`;
   - `PAYPHONE_API_URL` stays at its default unless Payphone gives another.
5. **A company to pay with.** Use one on Gratis with no open payment.

## The run

| # | Do | Expect |
|---|---|---|
| 1 | Plan y pagos → Elegir un plan → Emprende, mensual → Continuar al pago | A payment card "Plan Emprende, mensual", $11.39, "Por pagar", with **Transferencia** and **Tarjeta** |
| 2 | Click **Tarjeta** | Payphone's widget loads below the hint |
| 3 | Pay with Payphone's test card | Payphone redirects to `/es/plan/card-return?id=…&clientTransactionId=…` |
| 4 | Look at the return page | "Pago aprobado" |
| 5 | Volver al plan | The plan is Emprende with its monthly period, and the payment shows "Pagado" by card in Pagos |
| 6 | As super admin, open Por facturar | The payment is listed, method Tarjeta, $11.39 |
| 7 | Reload the return page from step 4 | "Pago aprobado" again, and no second charge in Payphone's dashboard |
| 8 | Optional: open the widget again for a new payment, such as a document pack, and decline with Payphone's declined test card | "El pago no se completó", and the payment is still "Por pagar" |

## If something goes wrong

- **The widget doesn't load:** the domain isn't registered in Payphone's console, or the browser blocks Payphone's script. Check the browser console.
- **The return page shows an error:** the company's card attempt holds Payphone's answer, without the payer's data:

  ```sql
  SELECT status, status_code, confirm_response FROM payphone_transactions ORDER BY created_at DESC LIMIT 1;
  ```

  Send that row (never the token) to whoever is fixing it.
- **"Estamos confirmando tu pago":** Payphone didn't answer in time. The worker's `payphone.reconcile` job asks again within 5 minutes, so the worker must be running.

When steps 1 to 7 pass, the gate passes: tell Claude, and Milestone 8 is closed in `NEXT_STEPS.md`.
