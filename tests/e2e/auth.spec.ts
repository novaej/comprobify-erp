import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import {
  checkAuthorization,
  createMockSri,
  createSriClient,
  sendDocument,
  verifyStockLevels,
} from '@comprobify/core';
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
  await grantFeature(ownerEmail, 'DOCUMENT_TEMPLATES', 'e2e templates');
}

// Nor credit notes (their own module).
async function grantFeature(ownerEmail: string, feature: string, reason: string): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.rls_system = 'on'`);
    await client.query(
      `INSERT INTO tenant_feature_overrides
         (tenant_id, feature_key, feature_kind, effect, limit_value, reason, created_by)
       SELECT m.tenant_id, $2, 'BOOLEAN', 'GRANT', NULL, $3, u.id
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE u.email = $1 AND m.role = 'OWNER'`,
      [ownerEmail, feature, reason],
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
async function runSri(
  documentId: string,
  answer: 'authorize' | 'return' | 'reject',
): Promise<void> {
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
    if (answer === 'reject')
      mock.queue('authorization', { kind: 'notAuthorized', code: '46', message: 'RUC no existe' });
    if (answer !== 'return') {
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

  test('credits an authorized invoice with a nota de crédito and links both ways (FR-DOC-9, FR-DOC-12)', async ({
    page,
  }) => {
    await grantFeature(email, 'DOC_TYPE_04', 'e2e credit notes');
    await signIn(page, email, newPassword);
    await expect(
      page.getByRole('navigation', { name: 'Navegación principal' }).last(),
    ).toBeVisible();
    const heading = page.getByRole('heading', { level: 1 });

    // The type is enabled at the issue point first.
    await page.goto('/es/settings');
    await page.getByRole('button', { name: 'Tipos de comprobante de 001-001' }).click();
    const types = page.getByRole('dialog', { name: 'Tipos de comprobante de 001-001' });
    await types.getByRole('checkbox', { name: 'Nota de crédito' }).check();
    await types.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Cambios guardados.')).toBeVisible();

    const invoice = await issueInvoice(page, '40');
    await runSri(invoice, 'authorize');
    await page.reload();
    await expect(heading).toContainText('Autorizado');
    await page.getByRole('link', { name: 'Nota de crédito' }).click();
    await expect(heading).toContainText('Nota de crédito de 001-001-');
    // Over the balance is said before anything is sent.
    const quantity = page.getByRole('textbox', { name: /Cantidad a acreditar de Mantenimiento/ });
    await quantity.fill('2');
    await expect(page.getByRole('alert').filter({ hasText: 'Supera lo que queda' })).toBeVisible();
    await page.getByRole('button', { name: 'Todo' }).click();
    await page.getByRole('textbox', { name: 'Motivo' }).fill('Servicio no prestado');
    await expect(page.getByRole('complementary')).toContainText('$46,00');
    await look(page, 'credit-note-new');
    await page.getByRole('button', { name: 'Emitir nota de crédito' }).click();
    await page
      .getByRole('dialog', { name: '¿Emitir la nota de crédito?' })
      .getByRole('button', { name: 'Emitir nota de crédito' })
      .click();

    await expect(heading).toContainText('Nota de crédito 001-001-');
    const note = page.url().split('/').at(-1)!;
    await expect(page.getByRole('main')).toContainText('Modifica a');
    await look(page, 'credit-note');
    await runSri(note, 'authorize');
    await page.reload();
    await expect(heading).toContainText('Autorizado');
    const ride = await page.request.get(`/es/documents/${note}/ride`);
    expect(ride.headers()['content-type']).toBe('application/pdf');
    expect((await ride.body()).subarray(0, 5).toString()).toBe('%PDF-');

    // The invoice shows its note, and has nothing left to credit.
    await page.goto(`/es/documents/${invoice}`);
    await expect(page.getByRole('main')).toContainText('Nota de crédito 001-001-');
    // Everything is credited: the action is gone, not a form with nothing to pick.
    await expect(page.getByRole('link', { name: 'Nota de crédito', exact: true })).toHaveCount(0);
    await look(page, 'document-credited');
  });

  test('issues a guía de remisión from an invoice and shows its transport (FR-SAL-9, FR-DOC-12)', async ({
    page,
  }) => {
    await grantFeature(email, 'DOC_TYPE_06', 'e2e delivery guides');
    await signIn(page, email, newPassword);
    await expect(
      page.getByRole('navigation', { name: 'Navegación principal' }).last(),
    ).toBeVisible();
    const heading = page.getByRole('heading', { level: 1 });

    await page.goto('/es/settings');
    await page.getByRole('button', { name: 'Tipos de comprobante de 001-001' }).click();
    const types = page.getByRole('dialog', { name: 'Tipos de comprobante de 001-001' });
    await types.getByRole('checkbox', { name: 'Guía de remisión' }).check();
    await types.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Cambios guardados.')).toBeVisible();

    const invoice = await issueInvoice(page, '50');
    await runSri(invoice, 'authorize');
    await page.reload();
    await expect(heading).toContainText('Autorizado');
    await page.getByRole('link', { name: 'Guía de remisión' }).click();
    await expect(heading).toContainText('Guía de remisión de 001-001-');
    // The buyer and the goods come from the invoice.
    await expect(
      page.getByRole('textbox', { name: 'Razón social o nombres', exact: true }),
    ).toHaveValue('María López');
    await expect(page.getByRole('textbox', { name: 'Descripción' })).toHaveValue('Mantenimiento');
    await page
      .getByRole('textbox', { name: 'Punto de partida' })
      .fill('Av. Amazonas N24-03, Quito');
    await page
      .getByRole('textbox', { name: 'Identificación del transportista' })
      .fill('1790012345001');
    await page
      .getByRole('textbox', { name: 'Razón social o nombres del transportista' })
      .fill('Transportes Andes S.A.');
    await page.getByRole('textbox', { name: 'Placa' }).fill('PCQ-1234');
    await look(page, 'guide-new');
    await page.getByRole('button', { name: 'Emitir guía de remisión' }).click();
    await page
      .getByRole('dialog', { name: '¿Emitir la guía de remisión?' })
      .getByRole('button', { name: 'Emitir guía de remisión' })
      .click();

    await expect(heading).toContainText('Guía de remisión 001-001-');
    const guide = page.url().split('/').at(-1)!;
    await expect(page.getByRole('main')).toContainText('PCQ-1234');
    await expect(page.getByRole('main')).toContainText('Mantenimiento');
    await look(page, 'guide');
    await runSri(guide, 'authorize');
    await page.reload();
    await expect(heading).toContainText('Autorizado');
    const ride = await page.request.get(`/es/documents/${guide}/ride`);
    expect((await ride.body()).subarray(0, 5).toString()).toBe('%PDF-');
    await page.goto(`/es/documents/${invoice}`);
    await expect(page.getByRole('main')).toContainText('Guía de remisión 001-001-');
  });

  test('keeps stock with its average cost: opening balance, adjustment and valuation (FR-INV-2, FR-INV-3, FR-INV-5)', async ({
    page,
  }) => {
    await grantFeature(email, 'INVENTORY', 'e2e inventory');
    await signIn(page, email, newPassword);
    const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    const heading = page.getByRole('heading', { level: 1 });

    // A good that tracks stock.
    await nav.getByRole('link', { name: 'Productos' }).click();
    await page.getByRole('button', { name: 'Nuevo producto' }).click();
    const productDialog = page.getByRole('dialog', { name: 'Nuevo producto' });
    await productDialog.getByRole('textbox', { name: 'Código', exact: true }).fill('CAF-001');
    await productDialog.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Café molido');
    await productDialog.getByLabel('Precio unitario').fill('5');
    await productDialog.getByRole('switch', { name: 'Controla inventario' }).click();
    await productDialog.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page.getByText('Producto creado.')).toBeVisible();

    await nav.getByRole('link', { name: 'Inventario' }).click();
    await expect(heading).toHaveText('Inventario');
    await page.getByRole('button', { name: 'Importar saldos iniciales' }).click();
    await expect(page.getByRole('dialog', { name: 'Importar saldos iniciales' })).toBeVisible();
    await look(page, 'inventory-import');
    await page.keyboard.press('Escape');
    await look(page, 'inventory');
    await page.getByRole('link', { name: 'Café molido', exact: true }).click();
    await expect(heading).toHaveText('Café molido');

    await page.getByRole('button', { name: 'Saldo inicial' }).click();
    const opening = page.getByRole('dialog', { name: 'Saldo inicial' });
    await opening.getByLabel('Cantidad').fill('10');
    await opening.getByLabel('Costo unitario sin IVA').fill('2,50');
    await opening.getByRole('button', { name: 'Registrar saldo inicial' }).click();
    await expect(page.getByText('Saldo inicial registrado.')).toBeVisible();
    // Only before the first movement: the button is gone.
    await expect(page.getByRole('button', { name: 'Saldo inicial' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Ajustar existencias' }).click();
    const adjust = page.getByRole('dialog', { name: 'Ajustar existencias' });
    await adjust.getByRole('combobox', { name: 'Tipo' }).click();
    await page.getByRole('option', { name: 'Salida' }).click();
    await adjust.getByLabel('Cantidad').fill('30');
    await adjust.getByLabel('Motivo').fill('Mercadería dañada');
    await adjust.getByRole('button', { name: 'Registrar ajuste' }).click();
    // Blocked by default: there are only 10.
    await expect(adjust.getByRole('alert')).toContainText('No hay suficientes existencias');
    await adjust.getByLabel('Cantidad').fill('3');
    await look(page, 'inventory-adjust');
    await adjust.getByRole('button', { name: 'Registrar ajuste' }).click();
    await expect(page.getByText('Ajuste registrado.')).toBeVisible();

    const main = page.getByRole('main');
    await expect(main).toContainText('$17,50');
    const movements = page.getByRole('table', { name: 'Movimientos' });
    await expect(movements.getByRole('row', { name: /Ajuste de salida/ })).toContainText(
      'Mercadería dañada',
    );
    await expect(movements.getByRole('row', { name: /Saldo inicial/ })).toContainText('$25,00');
    await look(page, 'inventory-product');

    await page.goto('/es/inventory/valuation');
    await expect(heading).toHaveText('Valoración del inventario');
    await expect(main).toContainText('$17,50');
    await look(page, 'inventory-valuation');
    const csv = await page.request.get('/es/inventory/valuation/csv');
    expect(await csv.text()).toContain('CAF-001;Café molido;;7;0;2,500000;17,50');

    // The rule is the company's, in Empresa.
    await page.goto('/es/settings');
    await expect(
      page.getByRole('switch', { name: 'Permitir existencias negativas' }),
    ).toBeVisible();
  });

  test('keeps the providers the company buys from (FR-MD-3)', async ({ page }) => {
    await grantFeature(email, 'PROVIDERS', 'e2e providers');
    await signIn(page, email, newPassword);
    const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    await nav.getByRole('link', { name: 'Proveedores' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Proveedores');
    await look(page, 'providers-empty');
    await page.getByRole('button', { name: 'Nuevo proveedor' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nuevo proveedor' });
    await dialog
      .getByRole('textbox', { name: 'Identificación', exact: true })
      .fill('1790012345001');
    await dialog.getByLabel('Nombre o razón social').fill('Distribuidora Andina S.A.');
    await dialog.getByLabel('Correos').fill('compras@andina.ec');
    await look(page, 'provider-new');
    await dialog.getByRole('button', { name: 'Crear proveedor' }).click();
    await expect(page.getByText('Proveedor creado.')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Proveedores' })).toContainText(
      'Distribuidora Andina S.A.',
    );
    await look(page, 'providers');
  });

  test('orders goods from a provider, emails it, receives it in parts and stocks it (FR-PUR-1 to FR-PUR-3)', async ({
    page,
  }) => {
    await grantFeature(email, 'PURCHASE_ORDERS', 'e2e purchase orders');
    await signIn(page, email, newPassword);
    const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    await nav.getByRole('link', { name: 'Órdenes de compra' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Órdenes de compra');
    await look(page, 'purchase-orders-empty');
    await page.getByRole('link', { name: 'Nueva orden' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nueva orden');
    await page.getByRole('combobox', { name: 'Buscar proveedor' }).fill('Andina');
    await page.getByRole('option', { name: /Distribuidora Andina/ }).click();
    const line = page.getByRole('group', { name: 'Línea 1' });
    await line.getByRole('combobox', { name: 'Producto' }).fill('molido');
    await page.getByRole('option', { name: /Café molido/ }).click();
    await line.getByRole('textbox', { name: 'Cantidad' }).fill('4');
    await line.getByRole('textbox', { name: 'Costo unitario' }).fill('2,75');
    // 11.00 plus the product's IVA.
    await expect(line.getByRole('status')).toHaveText('$11,00');
    await look(page, 'purchase-order-new');
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Orden OC-000001');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Borrador');
    await look(page, 'purchase-order-draft');

    // FR-PUR-3: the PDF, then the draft emailed to the provider, which sends it.
    const pdf = await page.request.get(
      (await page.getByRole('link', { name: 'Ver PDF' }).getAttribute('href'))!,
    );
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    await page.getByRole('button', { name: 'Enviar por correo' }).click();
    const emailDialog = page.getByRole('dialog', { name: 'Enviar la orden por correo' });
    await expect(emailDialog.getByLabel('Para')).toHaveValue('compras@andina.ec');
    await look(page, 'purchase-order-email');
    await emailDialog.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByText('La orden sale por correo en unos segundos.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Enviada');
    await expect(page.getByRole('link', { name: 'Editar' })).toHaveCount(0);
    await look(page, 'purchase-order-sent');

    // FR-PUR-2: one unit first, then the rest; the stock follows at the order's cost.
    await page.getByRole('link', { name: 'Recibir mercadería' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recibir mercadería');
    const now = page.getByRole('textbox', { name: 'Recibe ahora: Café molido' });
    await expect(now).toHaveValue('4');
    await now.fill('1');
    await look(page, 'purchase-order-receive');
    await page.getByRole('button', { name: 'Registrar recepción' }).click();
    await page
      .getByRole('dialog', { name: '¿Registrar la recepción?' })
      .getByRole('button', { name: 'Registrar recepción' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Recibida en parte');
    await page.getByRole('link', { name: 'Recibir mercadería' }).click();
    const rest = page.getByRole('textbox', { name: 'Recibe ahora: Café molido' });
    await expect(rest).toHaveValue('3');
    // More than is left says so beside the field, and on submit.
    await rest.fill('4');
    await expect(page.getByText('Puedes recibir hasta 3.')).toBeVisible();
    await page.getByRole('button', { name: 'Registrar recepción' }).click();
    await expect(page.getByText(/^Una cantidad pasa lo pendiente/)).toBeVisible();
    await page.getByRole('button', { name: 'Todo lo pendiente' }).click();
    await page.getByRole('button', { name: 'Registrar recepción' }).click();
    await page
      .getByRole('dialog', { name: '¿Registrar la recepción?' })
      .getByRole('button', { name: 'Registrar recepción' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText('en parte');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Recibida');
    await expect(
      page.getByRole('region', { name: 'Recepciones' }).getByText(/^Recepción del/),
    ).toHaveCount(2);
    await look(page, 'purchase-order-received');
    // 7 at 2.50 held before, plus 4 at 2.75.
    await nav.getByRole('link', { name: 'Inventario' }).click();
    const stock = page.getByRole('row', { name: /Café molido/ });
    await expect(stock).toContainText('11');
    await expect(stock).toContainText('$28,50');

    await page.getByRole('link', { name: 'Órdenes de compra' }).first().click();
    await expect(page.getByRole('table', { name: 'Órdenes de compra' })).toContainText(
      'Distribuidora Andina S.A.',
    );
    await look(page, 'purchase-orders');
  });

  test('holds stock for an invoice, sells it on authorization and takes a return (FR-SAL-2, FR-SAL-8, ADR-020)', async ({
    page,
  }) => {
    await signIn(page, email, newPassword);
    const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    const heading = page.getByRole('heading', { level: 1 });

    await expect(nav).toBeVisible();

    // 11 of Café molido on hand, from the order above: 3 of them invoiced.
    await page.goto('/es/documents/new');
    const client = page.getByRole('combobox', {
      name: 'Buscar cliente por nombre o identificación',
    });
    await client.fill('María');
    await client.press('Enter');
    const line = page.getByRole('group', { name: 'Línea 1' });
    await line.getByRole('combobox', { name: 'Código' }).fill('CAF-001');
    await page.keyboard.press('Enter');
    await expect(line.getByRole('textbox', { name: 'Descripción' })).toHaveValue('Café molido');
    await line.getByRole('textbox', { name: 'Cantidad' }).fill('3');
    await page.getByRole('button', { name: 'Emitir factura' }).click();
    await page
      .getByRole('dialog', { name: '¿Emitir la factura?' })
      .getByRole('button', { name: 'Emitir factura' })
      .click();
    await expect(heading).toContainText('Factura 001-001-');
    const invoice = page.url().split('/').at(-1)!;

    // Held, not gone: on hand stays at 11 until SRI authorizes.
    await nav.getByRole('link', { name: 'Inventario' }).click();
    await page.getByRole('link', { name: 'Café molido', exact: true }).click();
    const movements = page.getByRole('table', { name: 'Movimientos' });
    await expect(movements.getByRole('row', { name: /Reserva/ })).toContainText('+3 reservado');
    await look(page, 'inventory-product-reserved');
    await runSri(invoice, 'authorize');
    await page.reload();
    await expect(movements.getByRole('row', { name: /Venta/ })).toContainText('-3');
    await movements
      .getByRole('row', { name: /Venta/ })
      .getByRole('link', { name: 'Comprobante' })
      .click();
    await expect(heading).toContainText('Autorizado');

    // One comes back with a credit note that returns its goods.
    await page.getByRole('link', { name: 'Nota de crédito' }).click();
    await page.getByRole('textbox', { name: /Cantidad a acreditar de Café molido/ }).fill('1');
    await page.getByRole('textbox', { name: 'Motivo' }).fill('Producto devuelto');
    await page.getByRole('switch', { name: 'Devolver los productos al inventario' }).click();
    await look(page, 'credit-note-return-stock');
    await page.getByRole('button', { name: 'Emitir nota de crédito' }).click();
    await page
      .getByRole('dialog', { name: '¿Emitir la nota de crédito?' })
      .getByRole('button', { name: 'Emitir nota de crédito' })
      .click();
    await expect(heading).toContainText('Nota de crédito 001-001-');
    await runSri(page.url().split('/').at(-1)!, 'authorize');

    await nav.getByRole('link', { name: 'Inventario' }).click();
    const stock = page.getByRole('row', { name: /Café molido/ });
    // 11 − 3 + 1.
    await expect(stock).toContainText('9');
    await page.getByRole('link', { name: 'Café molido', exact: true }).click();
    await expect(movements.getByRole('row', { name: /Devolución/ })).toContainText('+1');
  });

  test('collects an invoice: a partial payment, the rest, a voided payment, and the aging report (FR-SAL-10)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await grantFeature(email, 'RECEIVABLES', 'e2e receivables');
    await signIn(page, email, newPassword);
    const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    await expect(nav).toBeVisible();
    const heading = page.getByRole('heading', { level: 1 });

    const invoice = await issueInvoice(page, '40');
    await runSri(invoice, 'authorize');
    await page.reload();
    await expect(heading).toContainText('Autorizado');
    const number = /001-001-\d{9}/.exec((await heading.textContent()) ?? '')![0];
    const card = page.getByRole('region', { name: 'Cobros' });
    await expect(card).toContainText('Sin cobrar');
    await expect(card).toContainText('$46,00');
    await look(page, 'invoice-receivable');

    // A part first: 20 of the 46.
    await card.getByRole('button', { name: 'Registrar cobro' }).click();
    const pay = page.getByRole('dialog', { name: 'Registrar un cobro' });
    await expect(pay.getByRole('textbox', { name: 'Valor' })).toHaveValue('46,00');
    await pay.getByRole('textbox', { name: 'Valor' }).fill('50');
    await pay.getByRole('button', { name: 'Registrar cobro' }).click();
    // Never more than is owed.
    await expect(pay.getByRole('alert')).toContainText('supera lo que se debe');
    await pay.getByRole('textbox', { name: 'Valor' }).fill('20');
    await pay.getByRole('textbox', { name: 'Referencia' }).fill('Transferencia 123');
    await look(page, 'receivable-payment');
    await pay.getByRole('button', { name: 'Registrar cobro' }).click();
    await expect(page.getByText('Cobro registrado.')).toBeVisible();
    await expect(card).toContainText('Cobro parcial');
    await expect(card).toContainText('Transferencia 123');
    await expect(card).toContainText('$26,00');

    // It is on the aging report, with what is left.
    await nav.getByRole('link', { name: 'Cuentas por cobrar' }).click();
    await expect(heading).toHaveText('Cuentas por cobrar');
    const owed = page.getByRole('table', { name: 'Cuentas por cobrar' });
    await expect(owed.getByRole('row', { name: new RegExp(number) })).toContainText('$26,00');
    await look(page, 'receivables');

    // The rest, and it leaves the report.
    await page.goto(`/es/documents/${invoice}`);
    await card.getByRole('button', { name: 'Registrar cobro' }).click();
    await expect(pay.getByRole('textbox', { name: 'Valor' })).toHaveValue('26,00');
    await pay.getByRole('button', { name: 'Registrar cobro' }).click();
    await expect(card).toContainText('Cobrada');
    await expect(card.getByRole('button', { name: 'Registrar cobro' })).toHaveCount(0);
    await nav.getByRole('link', { name: 'Cuentas por cobrar' }).click();
    await expect(heading).toHaveText('Cuentas por cobrar');
    await expect(page.getByRole('link', { name: number })).toHaveCount(0);

    // A mistaken payment is voided, and its amount is owed again.
    await page.goto(`/es/documents/${invoice}`);
    await card.getByRole('button', { name: 'Anular el cobro de $20,00' }).click();
    const voiding = page.getByRole('dialog', { name: 'Anular el cobro' });
    await voiding.getByRole('textbox', { name: 'Motivo' }).fill('Se registró dos veces');
    await look(page, 'receivable-void');
    await voiding.getByRole('button', { name: 'Anular cobro' }).click();
    await expect(page.getByText('Cobro anulado.')).toBeVisible();
    await expect(card).toContainText('Cobro parcial');
    await expect(card).toContainText('Se registró dos veces');
    await expect(card).toContainText('$20,00');
    await nav.getByRole('link', { name: 'Cuentas por cobrar' }).click();
    await expect(
      page
        .getByRole('table', { name: 'Cuentas por cobrar' })
        .getByRole('row', { name: new RegExp(number) }),
    ).toContainText('$20,00');
  });

  test('takes a sale order: draft, confirm to hold the goods, cancel to let them go (FR-SAL-1, FR-SAL-2)', async ({
    page,
  }) => {
    await grantFeature(email, 'SALE_ORDERS', 'e2e sale orders');
    await signIn(page, email, newPassword);
    const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    const heading = page.getByRole('heading', { level: 1 });
    await nav.getByRole('link', { name: 'Pedidos de venta' }).click();
    await expect(heading).toHaveText('Pedidos de venta');
    await look(page, 'sale-orders-empty');
    await page.getByRole('link', { name: 'Nuevo pedido' }).first().click();
    await expect(heading).toHaveText('Nuevo pedido');

    const client = page.getByRole('combobox', {
      name: 'Buscar cliente por nombre o identificación',
    });
    await client.fill('María');
    await client.press('Enter');
    await expect(page.getByText('María López')).toBeVisible();
    const line = page.getByRole('group', { name: 'Línea 1' });
    await line.getByRole('combobox', { name: 'Producto' }).fill('CAF-001');
    await page.keyboard.press('Enter');
    await expect(line.getByRole('textbox', { name: 'Precio unitario' })).toHaveValue('5');
    await line.getByRole('textbox', { name: 'Cantidad' }).fill('4');
    await expect(page.getByRole('region', { name: 'Totales' })).toContainText('$23,00');
    await look(page, 'sale-order-new');
    await page.getByRole('button', { name: 'Guardar borrador' }).click();

    await expect(heading).toContainText('Pedido PV-000001');
    await expect(heading).toContainText('Borrador');
    await expect(page.getByRole('main')).toContainText('María López');
    await look(page, 'sale-order-draft');
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await page
      .getByRole('dialog', { name: '¿Confirmar el pedido?' })
      .getByRole('button', { name: 'Confirmar pedido' })
      .click();
    await expect(heading).toContainText('Confirmado');
    await look(page, 'sale-order-confirmed');

    // Held: 4 of the 9 on hand are reserved.
    await nav.getByRole('link', { name: 'Inventario' }).click();
    await page.getByRole('link', { name: 'Café molido', exact: true }).click();
    const movements = page.getByRole('table', { name: 'Movimientos' });
    await expect(movements.getByRole('row', { name: /Reserva/ }).first()).toContainText(
      '+4 reservado',
    );
    await movements
      .getByRole('row', { name: /Reserva/ })
      .first()
      .getByRole('link', { name: 'Pedido de venta' })
      .click();
    await expect(heading).toContainText('Pedido PV-000001');

    await page.getByRole('button', { name: 'Anular' }).click();
    const cancel = page.getByRole('dialog', { name: 'Anular el pedido' });
    await cancel.getByRole('textbox', { name: 'Motivo' }).fill('El cliente desistió');
    await cancel.getByRole('button', { name: 'Anular pedido' }).click();
    await expect(heading).toContainText('Anulado');
    await expect(page.getByRole('main')).toContainText('El cliente desistió');

    await nav.getByRole('link', { name: 'Inventario' }).click();
    await page.getByRole('link', { name: 'Café molido', exact: true }).click();
    await expect(movements.getByRole('row', { name: /Liberación/ })).toContainText('-4 reservado');
    await nav.getByRole('link', { name: 'Pedidos de venta' }).click();
    await expect(page.getByRole('table', { name: 'Pedidos de venta' })).toContainText('Anulado');
    await look(page, 'sale-orders');
  });

  test('invoices a sale order in parts, corrects one through the order and finishes it (FR-SAL-3, FR-SAL-4, FR-SAL-6)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, email, newPassword);
    const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    await expect(nav).toBeVisible();
    const heading = page.getByRole('heading', { level: 1 });

    // 5 of Café molido for María, confirmed so they are held.
    await page.goto('/es/sale-orders/new');
    const client = page.getByRole('combobox', {
      name: 'Buscar cliente por nombre o identificación',
    });
    await client.fill('María');
    await client.press('Enter');
    const line = page.getByRole('group', { name: 'Línea 1' });
    await line.getByRole('combobox', { name: 'Producto' }).fill('CAF-001');
    await page.keyboard.press('Enter');
    await line.getByRole('textbox', { name: 'Cantidad' }).fill('5');
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await expect(heading).toContainText('Pedido PV-000002');
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await page
      .getByRole('dialog', { name: '¿Confirmar el pedido?' })
      .getByRole('button', { name: 'Confirmar pedido' })
      .click();
    await expect(heading).toContainText('Confirmado');

    // The first part: 2 of the 5.
    const orderUrl = page.url();
    const invoiceNow = async (quantity: string | null) => {
      await page.goto(`${orderUrl}/invoice`);
      await expect(heading).toContainText('Facturar el pedido PV-000002');
      const field = page.getByRole('textbox', { name: 'Cantidad a facturar de Café molido' });
      if (quantity) await field.fill(quantity);
      await page.getByRole('button', { name: 'Emitir factura' }).click();
      await page
        .getByRole('dialog', { name: '¿Emitir la factura?' })
        .getByRole('button', { name: 'Emitir factura' })
        .click();
      await expect(heading).toContainText('Factura 001-001-');
      return page.url().split('/').at(-1)!;
    };
    await page.goto(`${orderUrl}/invoice`);
    await expect(
      page.getByRole('textbox', { name: 'Cantidad a facturar de Café molido' }),
    ).toHaveValue('5');
    await page.getByRole('textbox', { name: 'Cantidad a facturar de Café molido' }).fill('6');
    await expect(page.getByRole('alert').filter({ hasText: 'Supera lo que queda' })).toBeVisible();
    await look(page, 'sale-order-invoice');
    const first = await invoiceNow('2');
    await expect(page.getByRole('main')).toContainText('PV-000002');
    await runSri(first, 'authorize');

    // The second part is returned by SRI, and corrected through the order.
    const second = await invoiceNow('3');
    await runSri(second, 'return');
    await page.goto(`/es/documents/${second}`);
    await expect(heading).toContainText('Devuelto');
    await page.getByRole('link', { name: 'Corregir' }).click();
    await expect(heading).toContainText('Corregir la factura 001-001-');
    await page.getByRole('textbox', { name: 'Cantidad a facturar de Café molido' }).fill('2');
    await look(page, 'sale-order-invoice-correct');
    await page.getByRole('button', { name: 'Corregir y reenviar' }).click();
    await page
      .getByRole('dialog', { name: '¿Corregir la factura?' })
      .getByRole('button', { name: 'Corregir y reenviar' })
      .click();
    await expect(heading).toContainText('Firmado');
    expect(page.url()).toContain(second);
    await runSri(second, 'authorize');

    // One is left: invoiced, the order is finished.
    await invoiceNow(null).then((last) => runSri(last, 'authorize'));
    await page.goto(orderUrl);
    await expect(heading).toContainText('Facturado');
    await expect(heading).not.toContainText('en parte');
    await expect(page.getByRole('main')).toContainText('Facturas');
    await expect(page.getByRole('link', { name: /^Factura 001-001-/ })).toHaveCount(3);
    await look(page, 'sale-order-invoiced');
    await expect(page.getByRole('button', { name: 'Anular' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirmar pedido' })).toHaveCount(0);

    // A guía goes with one of its invoices, started from the order's list.
    await page.getByRole('link', { name: 'Guía de remisión' }).first().click();
    await expect(heading).toContainText('Guía de remisión de 001-001-');
    await expect(
      page.getByRole('textbox', { name: 'Razón social o nombres', exact: true }),
    ).toHaveValue('María López');
    await expect(page.getByRole('textbox', { name: 'Descripción' })).toHaveValue('Café molido');
    await page
      .getByRole('textbox', { name: 'Punto de partida' })
      .fill('Av. Amazonas N24-03, Quito');
    await page
      .getByRole('textbox', { name: 'Identificación del transportista' })
      .fill('1790012345001');
    await page
      .getByRole('textbox', { name: 'Razón social o nombres del transportista' })
      .fill('Transportes Andes S.A.');
    await page.getByRole('textbox', { name: 'Placa' }).fill('PCQ-1234');
    await page.getByRole('button', { name: 'Emitir guía de remisión' }).click();
    await page
      .getByRole('dialog', { name: '¿Emitir la guía de remisión?' })
      .getByRole('button', { name: 'Emitir guía de remisión' })
      .click();
    await expect(heading).toContainText('Guía de remisión 001-001-');
    // The guía names its order through the invoice, and the order lists the guía.
    await page.getByRole('link', { name: 'PV-000002' }).click();
    await expect(heading).toContainText('Pedido PV-000002');
    await expect(page.getByRole('link', { name: /^Guía de remisión 001-001-/ })).toHaveCount(1);
  });

  test('Milestone 6 gate: 10 units invoiced 4 + 6 end INVOICED, a rejected invoice is corrected through its order, and a void returns its quantities (FR-SAL-1 to FR-SAL-6)', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, email, newPassword);
    const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    await expect(nav).toBeVisible();
    const heading = page.getByRole('heading', { level: 1 });
    const main = page.getByRole('main');

    // A product with 10 on hand.
    await nav.getByRole('link', { name: 'Productos' }).click();
    await page.getByRole('button', { name: 'Nuevo producto' }).click();
    const product = page.getByRole('dialog', { name: 'Nuevo producto' });
    await product.getByRole('textbox', { name: 'Código', exact: true }).fill('GATE-1');
    await product
      .getByRole('textbox', { name: 'Nombre', exact: true })
      .fill('Producto de la prueba');
    await product.getByLabel('Precio unitario').fill('10');
    await product.getByRole('switch', { name: 'Controla inventario' }).click();
    await product.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page.getByText('Producto creado.')).toBeVisible();
    await nav.getByRole('link', { name: 'Inventario' }).click();
    await page.getByRole('link', { name: 'Producto de la prueba', exact: true }).click();
    await page.getByRole('button', { name: 'Saldo inicial' }).click();
    const opening = page.getByRole('dialog', { name: 'Saldo inicial' });
    await opening.getByLabel('Cantidad').fill('10');
    await opening.getByLabel('Costo unitario sin IVA').fill('5');
    await opening.getByRole('button', { name: 'Registrar saldo inicial' }).click();
    await expect(page.getByText('Saldo inicial registrado.')).toBeVisible();
    const stockUrl = page.url();
    // On hand, available and reserved, as the page shows them.
    const stock = async () => {
      await page.goto(stockUrl);
      const text = (await main.textContent()) ?? '';
      const found = /Existencias(\d+)Disponible(\d+)Reservado(\d+)/.exec(text);
      expect(found, text).not.toBeNull();
      return found!.slice(1).map(Number);
    };
    expect(await stock()).toEqual([10, 10, 0]);

    // The order for all 10, confirmed: all held.
    await page.goto('/es/sale-orders/new');
    const client = page.getByRole('combobox', {
      name: 'Buscar cliente por nombre o identificación',
    });
    await client.fill('María');
    await client.press('Enter');
    const line = page.getByRole('group', { name: 'Línea 1' });
    await line.getByRole('combobox', { name: 'Producto' }).fill('GATE-1');
    await page.keyboard.press('Enter');
    await line.getByRole('textbox', { name: 'Cantidad' }).fill('10');
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await expect(heading).toContainText('Pedido PV-');
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await page
      .getByRole('dialog', { name: '¿Confirmar el pedido?' })
      .getByRole('button', { name: 'Confirmar pedido' })
      .click();
    await expect(heading).toContainText('Confirmado');
    const orderUrl = page.url();
    expect(await stock()).toEqual([10, 0, 10]);

    const invoiceNow = async (quantity: string) => {
      await page.goto(`${orderUrl}/invoice`);
      await page
        .getByRole('textbox', { name: 'Cantidad a facturar de Producto de la prueba' })
        .fill(quantity);
      await page.getByRole('button', { name: 'Emitir factura' }).click();
      await page
        .getByRole('dialog', { name: '¿Emitir la factura?' })
        .getByRole('button', { name: 'Emitir factura' })
        .click();
      await expect(heading).toContainText('Factura 001-001-');
      return page.url().split('/').at(-1)!;
    };

    // 4 invoiced and authorized: sold, the other 6 still held by the order.
    const first = await invoiceNow('4');
    await runSri(first, 'authorize');
    expect(await stock()).toEqual([6, 0, 6]);
    await page.goto(orderUrl);
    await expect(heading).toContainText('Facturado en parte');

    // The other 6 are rejected by SRI: they keep their goods, and are corrected through the order.
    const second = await invoiceNow('6');
    await runSri(second, 'reject');
    await page.goto(`/es/documents/${second}`);
    await expect(heading).toContainText('No autorizado');
    await page.getByRole('link', { name: 'Corregir' }).click();
    await expect(heading).toContainText('Corregir la factura 001-001-');
    await expect(
      page.getByRole('textbox', { name: 'Cantidad a facturar de Producto de la prueba' }),
    ).toHaveValue('6');
    await page.getByRole('button', { name: 'Corregir y reenviar' }).click();
    await page
      .getByRole('dialog', { name: '¿Corregir la factura?' })
      .getByRole('button', { name: 'Corregir y reenviar' })
      .click();
    await expect(heading).toContainText('Firmado');
    expect(page.url()).toContain(second);
    await runSri(second, 'authorize');
    await page.goto(orderUrl);
    await expect(heading).toContainText('Facturado');
    await expect(heading).not.toContainText('en parte');
    expect(await stock()).toEqual([0, 0, 0]);

    // Voiding the 6 returns them: back in stock and held by the order again.
    await page.goto(`/es/documents/${second}`);
    await page.getByRole('button', { name: 'Anular' }).click();
    await page
      .getByRole('dialog', { name: '¿Marcar la factura como anulada?' })
      .getByRole('button', { name: 'Marcar como anulada' })
      .click();
    await expect(page.getByText('Factura anulada.')).toBeVisible();
    await expect(heading).toContainText('Anulado');
    expect(await stock()).toEqual([6, 0, 6]);
    await page.goto(orderUrl);
    await expect(heading).toContainText('Facturado en parte');
    await look(page, 'sale-order-gate');
  });

  test('finds no drift between the stock levels and their ledger after the day (FR-INV-2, Milestone 5 gate)', async () => {
    // What the nightly inventory.verify job runs, over everything the tests above stocked.
    const silent = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };
    const db = createDatabase({ connectionString: process.env.DATABASE_URL!, logger: silent });
    try {
      const { checked, drifts } = await verifyStockLevels({ db, logger: silent });
      expect(checked).toBeGreaterThan(0);
      expect(drifts).toEqual([]);
    } finally {
      await db.close();
    }
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
    // The test copy's clients, products, providers and templates come along, unless unchecked.
    await expect(page.getByRole('checkbox', { name: /Llevar tus datos de pruebas/ })).toBeChecked();
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

    // What was entered while testing is now in the real company.
    await nav.getByRole('link', { name: 'Clientes' }).click();
    await expect(page.getByRole('main')).toContainText('María López');
    await nav.getByRole('link', { name: 'Productos' }).click();
    await expect(page.getByRole('main')).toContainText('Café molido');

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
