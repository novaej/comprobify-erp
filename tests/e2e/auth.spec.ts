import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { Client } from 'pg';

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
    // Signed in, with no organization yet: onboarding comes first.
    await expect(page).toHaveURL(/\/es\/onboarding$/);
  });

  test('signs out, refuses a wrong password, and signs back in', async ({ page }) => {
    await signIn(page, email, 'not the password');
    await expect(page.locator('form').getByRole('alert')).toHaveText(
      'Correo o contraseña incorrectos.',
    );
    // An error keeps what was typed.
    await expect(page.getByLabel('Correo electrónico')).toHaveValue(email);
    await signIn(page, email, password);
    await expect(page).toHaveURL(/\/es\/onboarding$/);
    await page.getByRole('link', { name: 'Mi cuenta' }).click();
    await expect(page.getByText('Hola, Ana Pérez')).toBeVisible();
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
    await expect(page).toHaveURL(/\/es\/onboarding$/);
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
    await expect(nav.getByRole('button', { name: 'Producción' })).toBeDisabled();
    await expect(nav.getByRole('button', { name: 'Pruebas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(nav.getByText('Propietario')).toBeVisible();

    // The first tab stop skips past the navigation.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();

    await nav.getByRole('link', { name: 'Mi cuenta' }).click();
    await expect(page.getByText('Pruebas, activa')).toBeVisible();
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
    await page.getByLabel('Correo electrónico').fill(viewerEmail);
    await page.getByLabel('Rol', { exact: true }).selectOption('VIEWER');
    await page.getByRole('button', { name: 'Enviar invitación' }).click();
    await expect(page.getByRole('list', { name: 'Invitaciones pendientes' })).toContainText(
      viewerEmail,
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
    await viewer.getByLabel('Nombre').fill('Vera Lector');
    await viewer.getByLabel('Contraseña', { exact: true }).fill('a viewer passphrase');
    await viewer.getByLabel('Confirmar contraseña').fill('a viewer passphrase');
    await viewer.getByRole('button', { name: 'Crear mi cuenta y aceptar' }).click();
    await expect(viewer).toHaveURL(/\/es\/dashboard$/);
    await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('Delta Comercial S.A.');

    // Read-only: no Users link, and the page itself refuses.
    const viewerNav = viewer.getByRole('navigation', { name: 'Navegación principal' }).last();
    await expect(viewerNav.getByText('Solo lectura')).toBeVisible();
    await expect(viewerNav.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
    await viewer.goto('/es/users');
    await expect(viewer.getByRole('heading', { name: 'No tienes acceso' })).toBeVisible();

    // The link works once.
    await viewer.goto(link);
    await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('Invitación no válida');

    // Removed: the next page sends them back to onboarding.
    await page.reload();
    await page.getByRole('button', { name: 'Quitar a Vera Lector' }).click();
    await expect(page.getByRole('list', { name: 'Miembros' })).not.toContainText('Vera Lector');
    await viewer.goto('/es/dashboard');
    await expect(viewer).toHaveURL(/\/es\/onboarding$/);
    await guest.close();
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

    // What an authenticator app does with the key.
    const key = (await page.locator('code').innerText()).trim();
    const totp = () => createOTP(new TextDecoder().decode(base32.decode(key))).totp();
    await page.getByLabel('Código de 6 dígitos de tu app').fill(await totp());
    await page.getByRole('button', { name: 'Confirmar y activar' }).click();
    await expect(page.getByText('La verificación en dos pasos está activada.')).toBeVisible();

    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(/\/es\/login\/two-factor$/);
    await page.getByLabel('Código', { exact: true }).fill('000000');
    await page.getByRole('button', { name: 'Verificar' }).click();
    await expect(page.locator('form').getByRole('alert')).toHaveText('Ese código no es válido.');
    await page.getByLabel('Código', { exact: true }).fill(await totp());
    await page.getByRole('button', { name: 'Verificar' }).click();
    await expect(page).toHaveURL(/\/es\/dashboard$/);

    // Requiring it of every member leaves this owner, who has it, at work.
    await page.goto('/es/users');
    await page.getByLabel('Exigir verificación en dos pasos a todos los miembros').check();
    await page.getByRole('button', { name: 'Guardar', exact: true }).first().click();
    await expect(
      page.getByLabel('Exigir verificación en dos pasos a todos los miembros'),
    ).toBeChecked();
    await page.goto('/es/dashboard');
    await expect(page).toHaveURL(/\/es\/dashboard$/);
  });
});
