import { expect, test } from '@playwright/test';

// Milestone 0 gate: the empty app serves, in both languages and themes.
test('health reports ok', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

// next-intl picks the locale from Accept-Language.
test.describe('a Spanish browser', () => {
  test.use({ locale: 'es-EC' });

  test('is sent from the root to /es', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/es$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByText('La base está lista', { exact: false })).toBeVisible();
  });
});

test.describe('an English browser', () => {
  test.use({ locale: 'en-US' });

  test('is sent from the root to /en', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/en$/);
  });
});

test('English is served under /en', async ({ page }) => {
  await page.goto('/en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByText('The foundations are ready', { exact: false })).toBeVisible();
});

test('unknown pages get the localized 404', async ({ page }) => {
  const response = await page.goto('/es/no-existe');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Página no encontrada' })).toBeVisible();
});

test('the theme toggle switches and persists without a flash', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/es');
  const html = page.locator('html');
  await expect(html).toHaveClass(/\blight\b/);

  await page.getByRole('button', { name: 'Cambiar a modo oscuro' }).click();
  await expect(html).toHaveClass(/\bdark\b/);

  // The class must be there before hydration, set by the theme script.
  await page.reload({ waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded');
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Cambiar a modo claro' })).toBeVisible();
});

test('the page logs no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/es');
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});
