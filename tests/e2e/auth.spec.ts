import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { checkAuthorization, createMockSri, createSriClient, sendDocument } from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { createDatabase } from '@comprobify/db';
import { Client } from 'pg';
import { look } from './look';

// The worker isn't needed: the link is read from the queued email.send job.
async function emailLink(
  to: string,
  template: 'verifyEmail' | 'resetPassword' | 'invitation',
): Promise<string> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ url: string }>(
      `SELECT data->'params'->>'url' AS url FROM pgboss.job
       WHERE name = 'email.send' AND data->>'to' = $1 AND data->>'template' = $2
       ORDER BY created_on DESC LIMIT 1`,
      [to, template],
    );
    if (!rows[0]) throw new Error(`No ${template} email for ${to}`);
    // The app may be behind Caddy on another port; keep only path and query.
    const url = new URL(rows[0].url);
    return `${url.pathname}${url.search}`;
  } finally {
    await client.end();
  }
}

// Gratis allows one user. The owner's companies get more seats from an override
// written here, so the invitation test doesn't depend on the admin area.
async function grantSeats(ownerEmail: string): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.rls_system = 'on'`);
    await client.query(
      `INSERT INTO tenant_feature_overrides
         (tenant_id, feature_key, feature_kind, effect, limit_value, reason, created_by)
       SELECT m.tenant_id, 'USERS', 'LIMIT', 'LIMIT', 20, 'e2e seats', u.id
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE u.email = $1 AND m.role = 'OWNER'`,
      [ownerEmail],
    );
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

// Gratis has no templates (the Branding module brings them): an exception, as above.
async function grantTemplates(ownerEmail: string): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.rls_system = 'on'`);
    await client.query(
      `INSERT INTO tenant_feature_overrides
         (tenant_id, feature_key, feature_kind, effect, limit_value, reason, created_by)
       SELECT m.tenant_id, 'DOCUMENT_TEMPLATES', 'BOOLEAN', 'GRANT', NULL, 'e2e templates', u.id
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE u.email = $1 AND m.role = 'OWNER'`,
      [ownerEmail],
    );
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

// The operator script's job, done directly: the flag is never set from the app.
async function setSuperAdmin(userEmail: string): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('UPDATE users SET is_super_admin = true WHERE email = $1', [userEmail]);
  } finally {
    await client.end();
  }
}

// What the worker does, run here against the mock SRI: the app Playwright starts has no
// worker. On the stack the worker may get there first; the handlers don't mind.
async function runSri(documentId: string, answer: 'authorize' | 'return'): Promise<void> {
  const silent = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };
  const db = createDatabase({ connectionString: process.env.DATABASE_URL!, logger: silent });
  try {
    const [row] = await db.withSystem('e2e: find the document to send', ({ executeSql }) =>
      executeSql<{ tenant_id: string; signed_xml: string; ambiente: '1' | '2' }>(
        'SELECT tenant_id, signed_xml, ambiente FROM documents WHERE id = $1',
        [documentId],
      ).then((result) => result.rows),
    );
    const ref = { tenantId: row!.tenant_id, documentId };
    const mock = createMockSri();
    if (answer === 'return')
      mock.queue('reception', { kind: 'returned', code: '35', message: 'DOCUMENTO INVÁLIDO' });
    const deps = {
      db,
      sri: createSriClient({ transport: mock.transport }),
      jobs: { enqueue: () => Promise.resolve(null) },
      clock: { now: () => new Date() },
      logger: silent,
    };
    await sendDocument(deps, ref);
    if (answer === 'authorize') {
      // On the stack the worker may have sent it already, to its own mock: this one learns
      // the document too, so it can authorize it.
      await deps.sri.send(row!.signed_xml, row!.ambiente);
      await checkAuthorization(deps, ref);
    }
  } finally {
    await db.close();
  }
}

// A one-line invoice to María López, from the form.
async function issueInvoice(page: Page, unitPrice: string): Promise<string> {
  await page.goto('/es/documents/new');
  const client = page.getByRole('combobox', { name: 'Buscar cliente por nombre o identificación' });
  await client.fill('María');
  await client.press('Enter');
  const line = page.getByRole('group', { name: 'Línea 1' });
  await line.getByRole('combobox', { name: 'Código' }).fill('P-9');
  await line.getByRole('textbox', { name: 'Descripción' }).fill('Mantenimiento');
  await line.getByRole('textbox', { name: 'Precio unitario' }).fill(unitPrice);
  await page.getByRole('button', { name: 'Emitir factura' }).click();
  await page
    .getByRole('dialog', { name: '¿Emitir la factura?' })
    .getByRole('button', { name: 'Emitir factura' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Factura 001-001-');
  return page.url().split('/').at(-1)!;
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/es/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

// One account per run keeps a re-run inside the per-IP sign-up limit.
test.describe.serial('account lifecycle (FR-ONB-1 to FR-ONB-7, FR-USR-2)', () => {
  test.use({ locale: 'es-EC' });
  const email = `e2e.${randomUUID()}@example.com`;
  const password = 'correct horse battery';
  const newPassword = 'a brand new passphrase';
  // Set by the two-step test, for the tests after it.
  let totp: () => Promise<string>;
  // This run's company: earlier runs left others with the same name.
  let companyRuc = '';

  test('protected pages send a visitor to sign in', async ({ page }) => {
    await page.goto('/es/account');
    await expect(page).toHaveURL(/\/es\/login$/);
  });

  test('registers, and the emailed link only verifies on the button press', async ({ page }) => {
    await page.goto('/es/register');
    await look(page, 'register');
    await page.getByLabel('Nombre').fill('Ana Pérez');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByLabel('Confirmar contraseña').fill(password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/es\/check-email$/);
    await look(page, 'check-email');

    const link = await emailLink(email, 'verifyEmail');
    // A link scanner's GET must not consume the token.
    expect((await page.request.get(link)).status()).toBe(200);
    await page.goto(link);
    await look(page, 'verify-email');
    await page.getByRole('button', { name: 'Confirmar mi correo' }).click();
    // Signed in, with no organization yet: onboarding comes first.
    await expect(page).toHaveURL(/\/es\/onboarding$/);
  });

  test('signs out, refuses a wrong password, and signs back in', async ({ page }) => {
    await signIn(page, email, 'not the password');
    await expect(page.locator('form').getByRole('alert')).toHaveText(
      'Correo o contraseña incorrectos.',
    );
    await look(page, 'login-error');
    // An error keeps what was typed.
    await expect(page.getByLabel('Correo electrónico')).toHaveValue(email);
    await signIn(page, email, password);
    await expect(page).toHaveURL(/\/es\/onboarding$/);
    await page.getByRole('link', { name: 'Mi cuenta' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mi cuenta');
    await look(page, 'account-no-company');
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page).toHaveURL(/\/es\/login$/);
    await page.goto('/es/account');
    await expect(page).toHaveURL(/\/es\/login$/);
  });

  test('resets the password through the emailed link', async ({ page }) => {
    await page.goto('/es/forgot-password');
    await look(page, 'forgot-password');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByRole('button', { name: 'Enviar enlace' }).click();
    await expect(page.getByText('Si ese correo corresponde a una cuenta')).toBeVisible();

    await page.goto(await emailLink(email, 'resetPassword'));
    await look(page, 'reset-password');
    await page.getByLabel('Contraseña', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirmar contraseña').fill(newPassword);
    await page.getByRole('button', { name: 'Restablecer contraseña' }).click();
    await expect(page).toHaveURL(/\/es\/login\?reason=reset$/);
    await expect(page.getByText('Tu contraseña cambió')).toBeVisible();

    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(/\/es\/onboarding$/);
  });

  test('sets up the company and lands in its test copy (FR-ONB-2 to FR-ONB-4)', async ({
    page,
  }) => {
    const ruc = testRuc();
    companyRuc = ruc;
    const p12 = (forRuc: string) => ({
      name: 'firma.p12',
      mimeType: 'application/x-pkcs12',
      buffer: createTestP12({ ruc: forRuc, password: 'clave' }),
    });
    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(/\/es\/onboarding$/);

    await look(page, 'onboarding');
    await page.getByLabel('RUC').fill(ruc);
    await page.getByLabel('Razón social').fill('Delta Comercial S.A.');
    await page.getByLabel('Dirección matriz').fill('Av. Amazonas N24, Quito');
    await page.getByLabel('Contraseña de la firma').fill('clave');
    // A signature that belongs to someone else is refused, and nothing is created.
    await page.getByLabel('Archivo de firma (.p12)').setInputFiles(p12(testRuc()));
    await page.getByRole('button', { name: 'Crear mi empresa' }).click();
    await expect(page.locator('form').getByRole('alert')).toHaveText(
      'La firma no pertenece a este RUC.',
    );

    // The form keeps every field after the error; only the file changes.
    await expect(page.getByLabel('RUC')).toHaveValue(ruc);
    await expect(page.getByLabel('Contraseña de la firma')).toHaveValue('clave');
    await page.getByLabel('Archivo de firma (.p12)').setInputFiles(p12(ruc));
    await page.getByRole('button', { name: 'Crear mi empresa' }).click();
    await expect(page).toHaveURL(/\/es\/dashboard\?welcome=1$/);
    await expect(page.getByText('Tu empresa está lista')).toBeVisible();
  });

  test('shows the shell: the organization, its test badge and the sandbox banner (FR-USR-5, FR-UX-2)', async ({
    page,
  }) => {
    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(/\/es\/dashboard$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Delta Comercial S.A.');
    const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    await expect(nav.getByText('SRI Pruebas')).toBeVisible();
    await expect(page.getByText('Estás en el ambiente de pruebas')).toBeVisible();
    // Production stays off until go-live (FR-ONB-5).
    await expect(nav.getByRole('button', { name: 'Producción', exact: true })).toBeDisabled();
    await expect(nav.getByRole('button', { name: 'Pruebas', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(nav.getByText('Propietario')).toBeVisible();
    await look(page, 'dashboard');

    // The first tab stop skips past the navigation.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();

    await nav.getByRole('link', { name: 'Mi cuenta' }).click();
    await expect(page.getByText('Pruebas, activa')).toBeVisible();
    await look(page, 'account');
  });

  test('shows the plan, its modules and limits (FR-PLAN-4)', async ({ page }) => {
    await signIn(page, email, newPassword);
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .last()
      .getByRole('link', { name: 'Plan' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan');
    await look(page, 'plan');
    await expect(page.getByText('Gratis', { exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Módulos' })).toContainText('Facturación');
    const usersRow = page.getByRole('main').getByText('Usuarios', { exact: true }).locator('..');
    await expect(usersRow).toContainText('1 de 1');
  });

  test('keeps the clients and products of the company (FR-MD-1, FR-MD-2)', async ({ page }) => {
    await signIn(page, email, newPassword);
    const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();

    await nav.getByRole('link', { name: 'Clientes' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clientes');
    await look(page, 'clients-empty');
    await page.getByRole('button', { name: 'Nuevo cliente' }).click();
    const clientDialog = page.getByRole('dialog', { name: 'Nuevo cliente' });
    await clientDialog
      .getByRole('textbox', { name: 'Identificación', exact: true })
      .fill('1710034066');
    await clientDialog.getByLabel('Nombre o razón social').fill('María López');
    await clientDialog.getByLabel('Correos').fill('maria@example.com');
    await look(page, 'client-new');
    await clientDialog.getByRole('button', { name: 'Crear cliente' }).click();
    // A cédula whose check digit doesn't match is refused, and what was typed stays.
    await expect(clientDialog.getByRole('alert')).toContainText(
      'la identificación debe ser válida',
    );
    await clientDialog
      .getByRole('textbox', { name: 'Identificación', exact: true })
      .fill('1710034065');
    await clientDialog.getByRole('button', { name: 'Crear cliente' }).click();
    await expect(page.getByText('Cliente creado.')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Clientes' })).toContainText('María López');
    await look(page, 'clients');

    await nav.getByRole('link', { name: 'Productos' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Productos y servicios');
    await page.getByRole('button', { name: 'Nuevo producto' }).click();
    const productDialog = page.getByRole('dialog', { name: 'Nuevo producto' });
    await productDialog.getByRole('textbox', { name: 'Código', exact: true }).fill('SRV-001');
    await productDialog
      .getByRole('textbox', { name: 'Nombre', exact: true })
      .fill('Asesoría contable');
    await productDialog.getByLabel('Precio unitario').fill('45,50');
    await look(page, 'product-new');
    await productDialog.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page.getByText('Producto creado.')).toBeVisible();
    const products = page.getByRole('table', { name: 'Productos y servicios' });
    await expect(products.getByRole('row', { name: /Asesoría contable/ })).toContainText('$45,50');
    await look(page, 'products');

    // Deactivating asks first, and the product stays listed as inactive.
    await page.getByRole('button', { name: 'Desactivar Asesoría contable' }).click();
    await page
      .getByRole('dialog', { name: '¿Desactivar el producto?' })
      .getByRole('button', { name: 'Desactivar' })
      .click();
    await expect(page.getByText('Producto desactivado.')).toBeVisible();
    await expect(products.getByRole('row', { name: /Asesoría contable/ })).toContainText(
      'Inactivo',
    );
  });

  test('sets the tax details and where the company issues from (FR-ONB-3, FR-PLAN-3)', async ({
    page,
  }) => {
    await signIn(page, email, newPassword);
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .last()
      .getByRole('link', { name: 'Empresa' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Empresa');
    await look(page, 'settings');

    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    const tax = page.getByRole('dialog', { name: 'Editar los datos tributarios' });
    await tax.getByRole('combobox', { name: 'Régimen' }).click();
    await page.getByRole('option', { name: 'RIMPE Emprendedor' }).click();
    await tax.getByLabel('Agente de retención').fill('1');
    await look(page, 'settings-tax');
    await tax.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Cambios guardados.')).toBeVisible();
    await expect(page.getByRole('main')).toContainText('RIMPE Emprendedor');

    // Gratis allows one branch: the second is refused, with the reason.
    await page.getByRole('button', { name: 'Agregar establecimiento' }).click();
    const branch = page.getByRole('dialog', { name: 'Agregar establecimiento' });
    await branch.getByRole('textbox', { name: 'Código del establecimiento' }).fill('002');
    await branch.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Norte');
    await branch
      .getByRole('textbox', { name: 'Dirección', exact: true })
      .fill('Av. 6 de Diciembre');
    await branch.getByRole('button', { name: 'Crear' }).click();
    await expect(branch.getByRole('alert')).toHaveText(
      'Tu plan no permite más. Revisa los límites en Plan.',
    );
    await branch.getByRole('button', { name: 'Cancelar' }).click();

    await page.getByRole('button', { name: 'Tipos de comprobante de 001-001' }).click();
    const types = page.getByRole('dialog', { name: 'Tipos de comprobante de 001-001' });
    await expect(types.getByRole('checkbox', { name: 'Factura' })).toBeChecked();
    await look(page, 'settings-types');
    await types.getByRole('button', { name: 'Cancelar' }).click();

    const issues = page.getByRole('switch', { name: 'Emite comprobantes desde 001-001' });
    await issues.click();
    await expect(page.getByText('Punto de emisión en pausa.')).toBeVisible();
    await issues.click();
    await expect(page.getByText('Punto de emisión activo.')).toBeVisible();
  });

  test('issues an invoice from the keyboard and shows what SRI answered (FR-DOC-2, FR-DOC-12, FR-UX-4)', async ({
    page,
  }) => {
    // The longest flow here: two invoices' worth of typing and the templates.
    test.setTimeout(90_000);
    await signIn(page, email, newPassword);
    const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();

    // The product deactivated earlier comes back, for the search.
    await nav.getByRole('link', { name: 'Productos' }).click();
    await page.getByRole('button', { name: 'Reactivar Asesoría contable' }).click();
    await page
      .getByRole('dialog', { name: '¿Reactivar el producto?' })
      .getByRole('button', { name: 'Reactivar' })
      .click();
    await expect(page.getByText('Producto reactivado.')).toBeVisible();
    // A fading toast fails axe's contrast check: let it go before the screens below.
    await expect(page.getByText('Producto reactivado.')).toBeHidden({ timeout: 10_000 });

    await nav.getByRole('link', { name: 'Comprobantes' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Comprobantes');
    await look(page, 'documents-empty');
    await page.getByRole('link', { name: 'Nueva factura' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nueva factura');
    await look(page, 'invoice-new');

    const client = page.getByRole('combobox', {
      name: 'Buscar cliente por nombre o identificación',
    });
    await client.fill('María');
    await client.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Nombre o razón social' })).toHaveValue(
      'María López',
    );
    // An edit to the client is saved with the invoice.
    await page
      .getByRole('textbox', { name: 'Dirección', exact: true })
      .fill('Av. Amazonas N24-03, Quito');
    await expect(
      page.getByText('Los cambios se guardan en el cliente al emitir la factura.'),
    ).toBeVisible();

    // A free-text line, typed field by field with Enter, which opens the next line.
    const line = (number: number) => page.getByRole('group', { name: `Línea ${number}` });
    await line(1).getByRole('combobox', { name: 'Código' }).fill('P-1');
    await page.keyboard.press('Enter');
    await expect(line(1).getByRole('textbox', { name: 'Descripción' })).toBeFocused();
    await page.keyboard.type('Consultoría');
    // Arriving by Enter selects the quantity's 1, so typing replaces it.
    await page.keyboard.press('Enter');
    await page.keyboard.type('2');
    await page.keyboard.press('Enter');
    await page.keyboard.type('10,50');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    // A product found by name fills the line and moves to the quantity.
    await expect(line(2).getByRole('combobox', { name: 'Código' })).toBeFocused();
    await page.keyboard.type('asesor');
    await page.keyboard.press('Enter');
    await expect(line(2).getByRole('textbox', { name: 'Descripción' })).toHaveValue(
      'Asesoría contable',
    );
    await expect(line(2).getByRole('textbox', { name: 'Cantidad' })).toBeFocused();

    // 21.00 + 45.50, with IVA 15 % rounded per line: 3.15 + 6.83.
    const totals = page.getByRole('complementary');
    await expect(totals).toContainText('$76,48');
    await look(page, 'invoice-filled');

    // Saved as a template, it fills a fresh form the same way (FR-MD-5).
    await grantTemplates(email);
    await page.reload();
    await client.fill('María');
    await client.press('Enter');
    await line(1).getByRole('combobox', { name: 'Código' }).fill('P-1');
    await line(1).getByRole('textbox', { name: 'Descripción' }).fill('Consultoría');
    await line(1).getByRole('textbox', { name: 'Cantidad' }).fill('2');
    await line(1).getByRole('textbox', { name: 'Precio unitario' }).fill('10,50');
    await page.getByRole('button', { name: 'Guardar como plantilla' }).click();
    const save = page.getByRole('dialog', { name: 'Guardar como plantilla' });
    await save.getByRole('textbox', { name: 'Nombre de la plantilla' }).fill('Consultoría mensual');
    await look(page, 'template-save');
    await save.getByRole('button', { name: 'Guardar como plantilla' }).click();
    await expect(page.getByText('Plantilla guardada.')).toBeVisible();
    await page.goto('/es/documents/new');
    await page.getByRole('button', { name: 'Cargar plantilla' }).click();
    const templates = page.getByRole('dialog', { name: 'Cargar una plantilla' });
    await expect(templates).toContainText('María López, 1 línea, $24,15');
    await look(page, 'template-load');
    await templates.getByRole('button', { name: /^Consultoría mensual/ }).click();
    await expect(line(1).getByRole('textbox', { name: 'Descripción' })).toHaveValue('Consultoría');
    await expect(page.getByRole('textbox', { name: 'Nombre o razón social' })).toHaveValue(
      'María López',
    );
    await expect(page.getByText('Plantilla guardada.')).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText('Plantilla cargada.')).toBeHidden({ timeout: 10_000 });

    // Back to the two-line invoice this test issues.
    await page.reload();
    await client.fill('María');
    await client.press('Enter');
    await page
      .getByRole('textbox', { name: 'Dirección', exact: true })
      .fill('Av. Amazonas N24-03, Quito');
    await line(1).getByRole('combobox', { name: 'Código' }).fill('P-1');
    await line(1).getByRole('textbox', { name: 'Descripción' }).fill('Consultoría');
    await line(1).getByRole('textbox', { name: 'Cantidad' }).fill('2');
    await line(1).getByRole('textbox', { name: 'Precio unitario' }).fill('10,50');
    await page.getByRole('button', { name: 'Agregar línea' }).click();
    await line(2).getByRole('combobox', { name: 'Código' }).fill('asesor');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('complementary')).toContainText('$76,48');
    await page.getByRole('button', { name: 'Emitir factura' }).click();
    const confirm = page.getByRole('dialog', { name: '¿Emitir la factura?' });
    await expect(confirm).toContainText('María López: $76,48');
    await look(page, 'invoice-confirm');
    await confirm.getByRole('button', { name: 'Emitir factura' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Factura 001-001-');
    const documentId = page.url().split('/').at(-1)!;
    await look(page, 'document');

    await expect(page.getByRole('status').filter({ hasText: 'se actualiza sola' })).toBeVisible();
    await runSri(documentId, 'authorize');
    // No reload: the page follows SRI's answer by itself.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Autorizado', {
      timeout: 30_000,
    });
    await expect(page.getByRole('main')).toContainText('Av. Amazonas N24-03, Quito');
    await expect(page.getByRole('main')).toContainText('Autorizado por el SRI');
    // The mock answered, and the page says so: this invoice never reached SRI.
    await expect(
      page.getByRole('alert').filter({ hasText: 'Autorizado por el simulador del SRI' }),
    ).toBeVisible();
    await look(page, 'document-authorized');
    // The history marks each step done.
    await page.getByRole('heading', { name: 'Historial' }).scrollIntoViewIfNeeded();
    await look(page, 'document-history');

    // The RIDE from the authorized XML, and SRI's <autorizacion> file.
    const ride = await page.request.get(`/es/documents/${documentId}/ride`);
    expect(ride.headers()['content-type']).toBe('application/pdf');
    expect((await ride.body()).subarray(0, 5).toString()).toBe('%PDF-');
    const xml = await page.request.get(`/es/documents/${documentId}/xml`);
    expect(await xml.text()).toContain('<estado>AUTORIZADO</estado>');

    await page.getByRole('link', { name: 'Comprobantes' }).first().click();
    const list = page.getByRole('table', { name: 'Comprobantes' });
    await expect(list).toContainText('María López');
    await expect(list).toContainText('Autorizado');
    await look(page, 'documents');
  });

  test('corrects a returned invoice, resends and voids an authorized one (FR-DOC-7, FR-DOC-8, FR-DOC-11)', async ({
    page,
  }) => {
    await signIn(page, email, newPassword);
    // Signed in before going anywhere by URL.
    await expect(
      page.getByRole('navigation', { name: 'Navegación principal' }).last(),
    ).toBeVisible();
    const heading = page.getByRole('heading', { level: 1 });

    // SRI returns it: the reasons show, and it waits on the pending screen.
    const returned = await issueInvoice(page, '20');
    await runSri(returned, 'return');
    await page.reload();
    await expect(heading).toContainText('Devuelto');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Por qué el SRI lo devolvió' }),
    ).toContainText('DOCUMENTO INVÁLIDO');
    await page.goto('/es/documents/pending');
    const needsYou = page.getByRole('table', { name: /Necesitan que los corrijas/ });
    await expect(needsYou).toContainText('Devuelto');
    await look(page, 'documents-pending');

    // The correction opens the form with what was signed, and keeps the number.
    await page.goto(`/es/documents/${returned}`);
    await page.getByRole('link', { name: 'Corregir' }).click();
    await expect(heading).toContainText('Corregir 001-001-');
    const line = page.getByRole('group', { name: 'Línea 1' });
    await expect(line.getByRole('textbox', { name: 'Descripción' })).toHaveValue('Mantenimiento');
    await line.getByRole('textbox', { name: 'Precio unitario' }).fill('25');
    await look(page, 'invoice-correct');
    await page.getByRole('button', { name: 'Corregir y enviar' }).click();
    await page
      .getByRole('dialog', { name: '¿Corregir y reenviar la factura?' })
      .getByRole('button', { name: 'Corregir y enviar' })
      .click();
    await expect(heading).toContainText('Firmado');
    expect(page.url()).toContain(returned);
    await expect(page.getByRole('complementary')).toContainText('$28,75');

    // An authorized one goes to the buyer again, and is voided once SRI shows it voided.
    const authorized = await issueInvoice(page, '30');
    await runSri(authorized, 'authorize');
    await page.reload();
    await expect(heading).toContainText('Autorizado');
    await page.getByRole('button', { name: 'Reenviar al comprador' }).click();
    const resend = page.getByRole('dialog', { name: '¿Reenviar al comprador?' });
    await expect(resend).toContainText('maria@example.com');
    await resend.getByRole('button', { name: 'Reenviar' }).click();
    await expect(page.getByText('Envío en curso.')).toBeVisible();

    await page.getByRole('button', { name: 'Anular' }).click();
    const voiding = page.getByRole('dialog', { name: '¿Marcar la factura como anulada?' });
    await expect(voiding).toContainText('portal');
    await look(page, 'document-void');
    await voiding.getByRole('button', { name: 'Marcar como anulada' }).click();
    await expect(page.getByText('Factura anulada.')).toBeVisible();
    await expect(heading).toContainText('Anulado');
  });

  test('invites a read-only member who joins and sees only what the role allows (FR-USR-1, FR-ROLE-3)', async ({
    page,
    browser,
  }) => {
    const viewerEmail = `viewer.${randomUUID()}@example.com`;
    await signIn(page, email, newPassword);
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .last()
      .getByRole('link', { name: 'Usuarios' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Usuarios');
    // Gratis has one seat, the owner's, so the page says so instead of offering the form.
    await expect(page.getByText(/^Tu plan permite 1 usuario/)).toBeVisible();
    await grantSeats(email);
    await page.reload();
    await look(page, 'users');
    await page.getByRole('button', { name: 'Invitar', exact: true }).click();
    const inviteDialog = page.getByRole('dialog', { name: 'Invitar' });
    await inviteDialog.getByLabel('Correo electrónico').fill(viewerEmail);
    await inviteDialog.getByRole('combobox', { name: 'Rol' }).click();
    await page.getByRole('option', { name: 'Solo lectura' }).click();
    await look(page, 'users-invite');
    await inviteDialog.getByRole('button', { name: 'Enviar invitación' }).click();
    await expect(page.getByText('Invitación enviada.')).toBeVisible();
    const members = page.getByRole('table', { name: 'Miembros' });
    await expect(members.getByRole('row', { name: new RegExp(viewerEmail) })).toContainText(
      'Invitado',
    );

    // The invitee opens the link in their own, signed-out browser.
    const guest = await browser.newContext({ locale: 'es-EC' });
    const viewer = await guest.newPage();
    const link = await emailLink(viewerEmail, 'invitation');
    expect((await viewer.request.get(link)).status()).toBe(200);
    await viewer.goto(link);
    await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(
      'Te invitaron a Delta Comercial S.A.',
    );
    await look(viewer, 'invite-accept');
    await viewer.getByLabel('Nombre').fill('Vera Lector');
    await viewer.getByLabel('Contraseña', { exact: true }).fill('a viewer passphrase');
    await viewer.getByLabel('Confirmar contraseña').fill('a viewer passphrase');
    await viewer.getByRole('button', { name: 'Crear mi cuenta y aceptar' }).click();
    await expect(viewer).toHaveURL(/\/es\/dashboard$/);
    await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('Delta Comercial S.A.');

    // Read-only: no Users or Plan link, and the page itself refuses.
    const viewerNav = viewer.getByRole('navigation', { name: 'Navegación principal' }).last();
    await expect(viewerNav.getByText('Solo lectura')).toBeVisible();
    await expect(viewerNav.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
    await expect(viewerNav.getByRole('link', { name: 'Plan' })).toHaveCount(0);
    await viewer.goto('/es/users');
    await expect(viewer.getByRole('heading', { name: 'No tienes acceso' })).toBeVisible();
    await look(viewer, 'no-access');

    // The link works once.
    await viewer.goto(link);
    await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('Invitación no válida');
    await look(viewer, 'invite-invalid');

    // Removed: the next page sends them back to onboarding.
    await page.reload();
    await page.getByRole('button', { name: 'Quitar a Vera Lector' }).click();
    const confirm = page.getByRole('dialog', { name: '¿Quitar de la empresa?' });
    await expect(confirm).toContainText('Vera Lector');
    await look(page, 'users-remove');
    await confirm.getByRole('button', { name: 'Quitar' }).click();
    await expect(page.getByText('Se quitó a la persona de la empresa.')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Miembros' })).not.toContainText('Vera Lector');
    await viewer.goto('/es/dashboard');
    await expect(viewer).toHaveURL(/\/es\/onboarding$/);
    await guest.close();
  });

  test('takes the company live and records it in the activity log (FR-ONB-5, FR-NOT-4)', async ({
    page,
  }) => {
    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(/\/es\/dashboard$/);

    // FR-ONB-8: with the legal texts on, the owner accepts them before going live.
    const agreements = process.env.E2E_AGREEMENTS === 'true';
    const reminder = page.getByText('Acepta los documentos legales');
    if (agreements) {
      await expect(reminder).toBeVisible();
      await page.getByRole('link', { name: 'Revisar y aceptar' }).click();
      const list = page.getByRole('table', { name: 'Documentos legales' });
      await expect(list.getByText('Pendiente')).toHaveCount(3);
      await look(page, 'legal');
      await list.getByRole('link', { name: /Acuerdo de Procesamiento de Datos/ }).click();
      // The company's own copy, with every placeholder filled.
      await expect(page.locator('article')).toContainText('Delta Comercial S.A.');
      await expect(page.locator('article')).not.toContainText('{{');
      await look(page, 'legal-document');
      await page.goBack();
      await page.getByLabel(/He leído y acepto, en nombre de mi empresa/).check();
      await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
      await expect(page.getByText('Documentos aceptados.')).toBeVisible();
      await expect(list.getByText(/Aceptado el/)).toHaveCount(3);
      await page.goto('/es/dashboard');
    }
    await expect(reminder).toHaveCount(0);
    await page.getByRole('link', { name: 'Pasar a producción' }).click();
    await expect(
      page.getByRole('heading', { name: 'Pasar Delta Comercial S.A. a producción' }),
    ).toBeVisible();
    // Coming from another provider: the real company continues at 101 (FR-ONB-5).
    await page.getByLabel('Siguiente número de 001-001 · Factura').fill('101');
    await look(page, 'go-live');
    await page.getByLabel('Entiendo que este paso no se puede deshacer.').check();
    await page.getByRole('button', { name: 'Pasar a producción' }).click();

    await expect(page).toHaveURL(/\/es\/dashboard\?live=1$/);
    await expect(page.getByText('Tu empresa está en producción')).toBeVisible();
    await expect(page.getByText('Estás en el ambiente de pruebas')).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    await expect(nav.getByText('SRI Producción')).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Producción', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await nav.getByRole('link', { name: 'Actividad' }).click();
    const log = page.getByRole('table', { name: 'Actividad' });
    await expect(log).toContainText('pasó la empresa a producción');
    await expect(log).toContainText('fijó los números iniciales: 001-001 01: 101');
    await expect(log).toContainText('inició sesión');
    if (agreements) await expect(log).toContainText('aceptó los documentos legales');
    await look(page, 'activity');
  });

  // Last: every sign-in after this one needs the code.
  test('turns on two-step verification and needs the code to sign in (FR-USR-3)', async ({
    page,
  }) => {
    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(/\/es\/dashboard$/);
    await page.goto('/es/account');
    await page.getByLabel('Tu contraseña, para activarla').fill(newPassword);
    await page.getByRole('button', { name: 'Activar' }).click();
    await expect(
      page.getByRole('img', { name: 'Código QR para tu app de autenticación' }),
    ).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Códigos de respaldo' }).getByRole('listitem'),
    ).toHaveCount(10);
    await look(page, 'two-factor-setup');

    // What an authenticator app does with the key.
    const key = (await page.locator('code').innerText()).trim();
    totp = () => createOTP(new TextDecoder().decode(base32.decode(key))).totp();
    await page.getByLabel('Código de 6 dígitos de tu app').fill(await totp());
    await page.getByRole('button', { name: 'Confirmar y activar' }).click();
    await expect(page.getByText('La verificación en dos pasos está activada.')).toBeVisible();

    await page
      .getByRole('main')
      .getByRole('button', { name: 'Cerrar sesión', exact: true })
      .click();
    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(/\/es\/login\/two-factor$/);
    await look(page, 'login-two-factor');
    await page.getByLabel('Código', { exact: true }).fill('000000');
    await page.getByRole('button', { name: 'Verificar' }).click();
    await expect(page.locator('form').getByRole('alert')).toHaveText('Ese código no es válido.');
    await page.getByLabel('Código', { exact: true }).fill(await totp());
    await page.getByRole('button', { name: 'Verificar' }).click();
    await expect(page).toHaveURL(/\/es\/dashboard$/);

    // Requiring it of every member leaves this owner, who has it, at work.
    await page.goto('/es/users');
    const requirement = page.getByRole('switch', {
      name: 'Exigir verificación en dos pasos a todos los miembros',
    });
    await requirement.click();
    await expect(page.getByText('Exigencia de verificación en dos pasos guardada.')).toBeVisible();
    await page.reload();
    await expect(requirement).toBeChecked();
    await page.goto('/es/dashboard');
    await expect(page).toHaveURL(/\/es\/dashboard$/);
  });

  test('lets a super admin change the company plan from the platform area (ADR-010, FR-ADM-1)', async ({
    page,
  }) => {
    await signIn(page, email, newPassword);
    await page.getByLabel('Código', { exact: true }).fill(await totp());
    await page.getByRole('button', { name: 'Verificar' }).click();
    await expect(page).toHaveURL(/\/es\/dashboard$/);
    // Not advertised to anyone without the flag.
    await page.goto('/es/admin');
    await expect(page.getByRole('heading', { name: 'Página no encontrada' })).toBeVisible();

    await setSuperAdmin(email);
    await page.goto('/es/dashboard');
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .last()
      .getByRole('link', { name: 'Administración de la plataforma' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Empresas');
    await look(page, 'admin-companies');
    await page.getByRole('searchbox', { name: 'Buscar por RUC o nombre' }).fill(companyRuc);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page
      .getByRole('row', { name: new RegExp(companyRuc) })
      .getByRole('link', { name: 'Delta Comercial S.A.' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Delta Comercial S.A.');
    await look(page, 'admin-company');

    await page.getByRole('button', { name: 'Cambiar plan' }).click();
    const planDialog = page.getByRole('dialog', { name: 'Cambiar plan' });
    await planDialog.getByRole('combobox', { name: 'Plan' }).click();
    await page.getByRole('option', { name: 'Negocio' }).click();
    await look(page, 'admin-plan-dialog');
    await planDialog.getByRole('button', { name: 'Cambiar plan' }).click();
    await expect(page.getByText('Plan cambiado.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Funciones activas' })).toContainText('INVENTORY');

    // The company sees it on its own plan page.
    await page.goto('/es/plan');
    await expect(page.getByText('Negocio', { exact: true })).toBeVisible();

    // FR-ADM-3: a new plan starts as a draft (plans are never deleted, so the run names it) with the base module; changes to it are immediate.
    await page.goto('/es/admin/plans');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Planes');
    await look(page, 'admin-plans');
    const planKey = `E2E_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
    await page.getByRole('button', { name: 'Nuevo plan' }).click();
    const newPlan = page.getByRole('dialog', { name: 'Nuevo plan' });
    await newPlan.getByLabel('Clave').fill(planKey);
    await newPlan.getByLabel('Nombre en español').fill(`Plan ${planKey}`);
    await newPlan.getByLabel('Nombre en inglés').fill('Test plan');
    await look(page, 'admin-plan-new');
    await newPlan.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByText('Plan creado.')).toBeVisible();
    await page.getByRole('link', { name: `Plan ${planKey}` }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Plan ${planKey}`);
    const planModules = page.getByRole('list', { name: 'Módulos del plan' });
    await expect(planModules).toContainText('Facturación');
    await page.getByRole('button', { name: 'Agregar módulo' }).click();
    const addModule = page.getByRole('dialog', { name: 'Agregar módulo' });
    await addModule.getByRole('combobox', { name: 'Módulo' }).click();
    await page.getByRole('option', { name: 'Inventario' }).click();
    await addModule.getByRole('button', { name: 'Agregar' }).click();
    await expect(page.getByText('Módulo agregado al plan.')).toBeVisible();
    await expect(planModules).toContainText('Inventario');
    await look(page, 'admin-plan');

    await page.goto('/es/admin/modules');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Módulos');
    await look(page, 'admin-modules');
    await page.getByRole('link', { name: 'Facturación', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Funciones del módulo' })).toContainText(
      'DOC_TYPE_01',
    );
    await look(page, 'admin-module');
  });

  // Milestone 2 gate: switching a feature for one company changes its screens; core refuses
  // what the screen no longer offers (tests/integration/milestone-2-gate.test.ts).
  test('changes what the company can do when the super admin sets an exception (ADR-011)', async ({
    page,
  }) => {
    await signIn(page, email, newPassword);
    await page.getByLabel('Código', { exact: true }).fill(await totp());
    await page.getByRole('button', { name: 'Verificar' }).click();
    await expect(page).toHaveURL(/\/es\/dashboard$/);

    const company = async () => {
      await page.goto(`/es/admin?q=${companyRuc}`);
      await page
        .getByRole('row', { name: new RegExp(companyRuc) })
        .getByRole('link', { name: 'Delta Comercial S.A.' })
        .click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Delta Comercial S.A.');
    };
    const users = async () => {
      await page.goto('/es/users');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Usuarios');
    };

    // One user, the owner: the company can't invite anyone.
    await company();
    await page.getByRole('button', { name: 'Agregar excepción' }).click();
    const exception = page.getByRole('dialog', { name: 'Agregar excepción' });
    await exception.getByRole('combobox', { name: 'Función' }).click();
    await page.getByRole('option', { name: 'USERS', exact: true }).click();
    await exception.getByLabel('Valor del límite').fill('1');
    await exception.getByLabel('Motivo').fill('Prueba del hito 2');
    await look(page, 'admin-exception');
    await exception.getByRole('button', { name: 'Guardar excepción' }).click();
    await expect(page.getByText('Excepción guardada.')).toBeVisible();
    await users();
    await expect(page.getByText(/^Tu plan permite 1 usuario/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invitar', exact: true })).toBeDisabled();

    // Without the exception, Negocio's five users apply again.
    await company();
    await page.getByRole('button', { name: 'Quitar la excepción de USERS' }).click();
    await page
      .getByRole('dialog', { name: '¿Quitar la excepción?' })
      .getByRole('button', { name: 'Quitar' })
      .click();
    await expect(page.getByText('Excepción quitada.')).toBeVisible();
    await users();
    await expect(
      page.getByText('1 de 5 usuarios, contando las invitaciones pendientes'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invitar', exact: true })).toBeEnabled();
  });
});
