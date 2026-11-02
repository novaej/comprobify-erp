import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { Client } from 'pg';

// The worker isn't needed: the link is read from the queued email.send job.
async function emailLink(to: string, template: 'verifyEmail' | 'resetPassword'): Promise<string> {
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

  test('protected pages send a visitor to sign in', async ({ page }) => {
    await page.goto('/es/account');
    await expect(page).toHaveURL(/\/es\/login$/);
  });

  test('registers, and the emailed link only verifies on the button press', async ({ page }) => {
    await page.goto('/es/register');
    await page.getByLabel('Nombre').fill('Ana Pérez');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByLabel('Confirmar contraseña').fill(password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/es\/check-email$/);

    const link = await emailLink(email, 'verifyEmail');
    // A link scanner's GET must not consume the token.
    expect((await page.request.get(link)).status()).toBe(200);
    await page.goto(link);
    await page.getByRole('button', { name: 'Confirmar mi correo' }).click();
    await expect(page).toHaveURL(/\/es\/account$/);
    await expect(page.getByText('Hola, Ana Pérez')).toBeVisible();
  });

  test('signs out, refuses a wrong password, and signs back in', async ({ page }) => {
    await signIn(page, email, 'not the password');
    await expect(page.locator('form').getByRole('alert')).toHaveText(
      'Correo o contraseña incorrectos.',
    );
    // An error keeps what was typed.
    await expect(page.getByLabel('Correo electrónico')).toHaveValue(email);
    await signIn(page, email, password);
    await expect(page).toHaveURL(/\/es\/account$/);
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page).toHaveURL(/\/es\/login$/);
    await page.goto('/es/account');
    await expect(page).toHaveURL(/\/es\/login$/);
  });

  test('resets the password through the emailed link', async ({ page }) => {
    await page.goto('/es/forgot-password');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByRole('button', { name: 'Enviar enlace' }).click();
    await expect(page.getByText('Si ese correo corresponde a una cuenta')).toBeVisible();

    await page.goto(await emailLink(email, 'resetPassword'));
    await page.getByLabel('Contraseña', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirmar contraseña').fill(newPassword);
    await page.getByRole('button', { name: 'Restablecer contraseña' }).click();
    await expect(page).toHaveURL(/\/es\/login\?reason=reset$/);
    await expect(page.getByText('Tu contraseña cambió')).toBeVisible();

    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(/\/es\/account$/);
  });

  test('sets up the company and lands in its test copy (FR-ONB-2 to FR-ONB-4)', async ({
    page,
  }) => {
    const ruc = testRuc();
    const p12 = (forRuc: string) => ({
      name: 'firma.p12',
      mimeType: 'application/x-pkcs12',
      buffer: createTestP12({ ruc: forRuc, password: 'clave' }),
    });
    await signIn(page, email, newPassword);
    await page.getByRole('link', { name: 'Configurar mi empresa' }).click();
    await expect(page).toHaveURL(/\/es\/onboarding$/);

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
    await expect(page).toHaveURL(/\/es\/account\?welcome=1$/);
    await expect(page.getByText('Tu empresa está lista')).toBeVisible();
    await expect(page.getByText('Delta Comercial S.A.')).toBeVisible();
    await expect(page.getByText('Pruebas, activa')).toBeVisible();
  });
});
