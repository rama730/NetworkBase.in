import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.15 W3, W4 (plan A6.34).
async function open(page: Page, opts: { edit?: boolean; view?: string; width?: number } = {}) {
  await page.setViewportSize({ width: opts.width ?? 1200, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      setDocsSiteAction: async (_p: string, input: unknown) => { calls.push(['site', input]); return { success: true }; },
      readDocsSettingsAction: async () => ({ success: true, siteEnabled: false, snippetsEnabled: false, canManage: true }),
      setDocsSettingsAction: async (_p: string, input: unknown) => { calls.push(['settings', input]); return { success: true }; },
    };
  });
  const q = new URLSearchParams({ ...(opts.edit ? { edit: '1' } : {}), ...(opts.view ? { view: opts.view } : {}) }).toString();
  await openApp(page, 'tests/browser/docs-site.fixture.tsx', q ? { path: `/?${q}` } : undefined);
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('W3/W4 reader: menu holds only site documents in order, current page marked; On this page; Previous / Next; search', async ({ page }) => {
  await open(page);
  const menu = page.getByTestId('docs-site-menu');
  await expect(menu.getByRole('button')).toHaveText(['Getting started', 'Guides', 'FAQ']);
  await expect(menu.getByRole('button', { name: 'Guides' })).toHaveAttribute('aria-current', 'page');
  await expect(menu).not.toContainText('Not on the site');
  await expect(page.getByTestId('docs-on-this-page').getByRole('link')).toHaveText(['Install', 'Sign in', 'First task']);
  const bar = page.getByTestId('docs-prev-next');
  await expect(bar).toContainText(/Previous\s*Getting started.*Next\s*FAQ/);
  await bar.getByRole('button', { name: /Next/ }).click();
  await expect(menu.getByRole('button', { name: 'FAQ' })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: 'test-results/docs-site/reader.png' });
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByLabel('Search docs')).toBeFocused();
  await page.keyboard.type('zzz');
  await expect(menu).toContainText('No results for “zzz”');
  await page.getByLabel('Search docs').fill('gui');
  await expect(menu.getByRole('button')).toHaveText(['Guides']);
  expect(await axeViolations(page)).toEqual([]);
});

test('W3 editor: Not on the site folded, Show on docs site toggles, Move down renumbers the section', async ({ page }) => {
  await open(page, { edit: true });
  const menu = page.getByTestId('docs-site-menu');
  await expect(menu.getByText('Not on the site (1)')).toBeVisible();
  await expect(page.getByTestId('docs-site-toggle')).toHaveText('On docs site');
  await page.getByTestId('docs-site-toggle').click();
  expect(await calls(page)).toEqual([['site', { docSlug: 'guides', on: false }]]);
  await menu.getByRole('button', { name: 'Move Guides down' }).click();
  await expect.poll(() => calls(page)).toEqual([
    ['site', { docSlug: 'guides', on: false }],
    ['site', { docSlug: 'start', on: true, order: 0 }], ['site', { docSlug: 'faq', on: true, order: 1 }], ['site', { docSlug: 'guides', on: true, order: 2 }],
  ]);
  expect(await axeViolations(page)).toEqual([]);
});

test('Settings → Documents: Docs site switch, off by default', async ({ page }) => {
  await open(page, { view: 'settings', width: 375 });
  const box = page.getByTestId('docs-settings');
  const site = box.getByRole('checkbox', { name: /Docs site/ });
  await expect(site).not.toBeChecked();
  await site.check();
  expect(await calls(page)).toEqual([['settings', { siteEnabled: true }]]);
  expect(await axeViolations(page)).toEqual([]);
});
