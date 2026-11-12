import { expect, test } from '@playwright/test';
import { look } from './look';

// FR-UX-5: the public pages, seen without signing in. Prices are the starting placeholders
// (ADR-027), which the platform area replaces; the page reads whatever is in the database.
test.describe('the public pages', () => {
  test.use({ locale: 'es-EC' });

  test('the landing page shows the product, the plans and a way in', async ({ page }) => {
    await page.goto('/es');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Facturación electrónica');
    await expect(page.getByRole('heading', { name: 'Empieza en tres pasos' })).toBeVisible();
    // The teaser reads live prices: the placeholder for Emprende (STARTER) is $9,90 + IVA.
    await expect(page.getByText('$9,90').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Crear cuenta gratis' }).first()).toBeVisible();
    // The steps walk on their own once in view, and a click picks one.
    await page.locator('#como-empezar').scrollIntoViewIfNeeded();
    const last = page.getByRole('button', { name: 'Emite tu primera factura' });
    await expect(last).toHaveAttribute('aria-current', 'step', { timeout: 8000 });
    const first = page.getByRole('button', { name: 'Crea tu cuenta gratis' });
    await first.click();
    await expect(first).toHaveAttribute('aria-current', 'step');
    // The FAQ opens and closes with no script.
    const question = page.getByText('¿Solo sirve para facturar?');
    await question.click();
    await expect(page.getByText('Cada plan incluye algunos módulos')).toBeVisible();
    await look(page, 'landing');
  });

  test('the pricing page lists the plans, switches to yearly and compares', async ({ page }) => {
    await page.goto('/es/pricing');
    await expect(page.getByRole('heading', { level: 1, name: 'Planes y precios' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Emprende' })).toBeVisible();
    await expect(page.getByText('$9,90').first()).toBeVisible();
    await page.getByRole('button', { name: /Anual/ }).click();
    // Yearly is ten months for twelve (FR-BILL-1): 9.90 x 10.
    await expect(page.getByText('$99', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Compara los planes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Módulos adicionales' })).toBeVisible();
    await look(page, 'pricing');
  });

  test('the support page gives the contact details', async ({ page }) => {
    await page.goto('/es/support');
    await expect(page.getByRole('heading', { level: 1, name: 'Soporte' })).toBeVisible();
    // The deployment's SUPPORT_EMAIL is set in the app Playwright starts.
    if (process.env.E2E_AGREEMENTS === 'true') {
      await expect(page.getByRole('link', { name: /soporte@example\.com/ })).toBeVisible();
    }
    await look(page, 'support');
  });

  test('the header leads to the other pages and into the app', async ({ page }) => {
    await page.goto('/es');
    const nav = page.getByRole('navigation', { name: 'Principal' });
    await nav.getByRole('link', { name: 'Precios' }).click();
    await expect(page).toHaveURL(/\/es\/pricing$/);
    await nav.getByRole('link', { name: 'Soporte' }).click();
    await expect(page).toHaveURL(/\/es\/support$/);
    await page.getByRole('link', { name: 'Crear cuenta' }).first().click();
    await expect(page).toHaveURL(/\/es\/register/);
  });

  test('English is served under /en', async ({ page }) => {
    await page.goto('/en/pricing');
    await expect(page.getByRole('heading', { level: 1, name: 'Plans & pricing' })).toBeVisible();
    await expect(page.getByText('+ VAT').first()).toBeVisible();
  });
});
