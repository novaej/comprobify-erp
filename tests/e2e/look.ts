import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const dir = process.env.E2E_SCREENSHOTS;
if (dir) mkdirSync(dir, { recursive: true });

// Mid-fade or mid-transition, colours are neither the old nor the new ones.
// Capped, as a paused or very long animation would otherwise never settle.
const settle = (page: Page) =>
  page.evaluate(() =>
    Promise.race([
      Promise.allSettled(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished),
      ),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]),
  );

const setTheme = async (page: Page, theme: 'light' | 'dark') => {
  await page.evaluate((next) => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(next);
  }, theme);
  await settle(page);
};

async function serious(page: Page) {
  // Metadata streams in after a client-side navigation, so the title may arrive last.
  await page.waitForFunction(() => document.title !== '');
  await settle(page);
  const axe = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
  ]);
  // Behind an open dialog the page is dimmed and inert, so only the dialog is checked.
  if ((await page.getByRole('dialog').count()) > 0) axe.include('[role="dialog"]');
  const { violations } = await axe.analyze();
  return violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      rule: violation.id,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    }));
}

// Every screen the flow reaches, in both themes: axe must find nothing serious, and with
// E2E_SCREENSHOTS set the screen is saved at desktop and phone width (FR-UX-2, FR-UX-3).
export async function look(page: Page, name: string): Promise<void> {
  expect(await serious(page), `accessibility problems on ${name}`).toEqual([]);
  const initial = (await page.evaluate(() => document.documentElement.classList.contains('dark')))
    ? 'dark'
    : 'light';
  await setTheme(page, initial === 'dark' ? 'light' : 'dark');
  expect(await serious(page), `accessibility problems on ${name} (other theme)`).toEqual([]);
  if (dir) await page.screenshot({ path: join(dir, `${name}.dark.png`), fullPage: true });
  await setTheme(page, initial);

  if (!dir) return;
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  await page.screenshot({ path: join(dir, `${name}.phone.png`), fullPage: true });
  await page.setViewportSize(size);
}
