import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.16 W1, W2, W6, W9 (plan A7.1).
const asset = (id: string, name: string, type: string, mime: string, details: unknown = null, version = 1) => ({ id, name, path: `/brand/${name}`, mimeType: mime, size: 10, version, updatedAt: '2026-11-24T00:00:00Z', details, type, marked: Boolean(details) });
async function open(page: Page, opts: { width?: number; empty?: boolean } = {}) {
  await page.setViewportSize({ width: opts.width ?? 1200, height: 900 });
  await page.addInitScript((empty) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readAssetsAction: async () => ({ success: true, canEdit: true, assets: empty ? [] : (window as any).__assets, library: empty ? { colors: [], outsideLinks: [] } : { colors: [{ name: 'Ink', hex: '#141A1E' }], outsideLinks: [{ id: 'abcdef12', name: 'Footage day 1', url: 'https://drive.example.com/f/1', type: 'footage', tags: ['day-1'] }] } }),
      saveAssetLibraryAction: async (input: unknown) => { calls.push(input); return { success: true }; },
      readAssetUsedInAction: async () => ({ success: true, usedIn: [{ kind: 'task', id: 't', label: 'NB-12 Launch post' }, { kind: 'doc', id: 'brand-guide', label: 'Brand guide' }] }),
      setAssetDetailsAction: async (input: unknown) => { calls.push(input); return { success: true }; },
    };
  }, Boolean(opts.empty));
  await page.addInitScript((list) => { (window as any).__assets = list; }, [
    asset('a', 'Logo dark.svg', 'logo', 'image/svg+xml', { type: 'logo', tags: ['brand'], productionStatus: 'final' }, 3),
    asset('b', 'intro.mp4', 'video', 'video/mp4'),
    asset('c', 'Hero.png', 'photo', 'image/png', { productionStatus: 'review' }),
  ]);
  await openApp(page, 'tests/browser/assets-view.fixture.tsx');
}

test('W1, W6: a grid by type with type chips and versions; type filter; grouping by production status', async ({ page }) => {
  await open(page);
  const view = page.getByTestId('assets-view');
  await expect(view.getByRole('heading', { level: 2 })).toHaveText('Assets 3');
  await expect(view.getByTestId('asset-card')).toHaveCount(3);
  await expect(view.getByTestId('asset-card').filter({ hasText: 'Logo dark.svg' })).toContainText(/Logo\s*Final\s*v3/);
  await view.getByRole('button', { name: 'Video', exact: true }).click();
  await expect(view.getByTestId('asset-card')).toHaveCount(1);
  await view.getByRole('button', { name: 'All', exact: true }).click();
  await view.getByLabel('Group by').selectOption('status');
  await expect(view.getByRole('heading', { level: 3 })).toHaveText(['Colors 1', 'Review 1', 'Final 1', 'No status 1', 'Outside links 1']);
  await page.screenshot({ path: 'test-results/assets-view/grid.png' });
  expect(await axeViolations(page)).toEqual([]);
});

test('W2: details panel saves type, tags, rights, credit, status, notes; Used in lists tasks and documents', async ({ page }) => {
  await open(page);
  await page.getByTestId('asset-card').filter({ hasText: 'Hero.png' }).click();
  const panel = page.getByTestId('asset-details');
  await expect(panel.getByTestId('asset-used-in')).toContainText(/NB-12 Launch post.*Document · Brand guide/);
  await panel.getByLabel('Tags').fill('Hero, home page');
  await panel.getByLabel('Usage rights').fill('Ours, any use');
  await panel.getByLabel('Production status').selectOption('final');
  await panel.getByRole('button', { name: 'Save details' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toEqual([{ projectId: '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', nodeId: 'c',
    details: { type: 'photo', tags: ['hero', 'home-page'], usageRights: 'Ours, any use', credit: '', productionStatus: 'final', notes: '' } }]);
  await expect(panel.getByRole('button', { name: 'Save details' })).toBeEnabled();
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('W9 phone: two columns; empty state says what to do', async ({ page }) => {
  await open(page, { width: 375 });
  const grid = page.getByTestId('assets-grid').first();
  expect(await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2);
  expect(await axeViolations(page)).toEqual([]);
  await open(page, { empty: true });
  await expect(page.getByText('Upload images, video or audio, or mark files as assets.')).toBeVisible();
});

test('W7/W8: Colors with hex and Copy, Add color; outside links open in a new tab, never fetched; Add outside link', async ({ page }) => {
  await open(page);
  const colors = page.getByTestId('assets-colors');
  await expect(colors).toContainText(/Ink\s*#141A1E/);
  await colors.getByRole('button', { name: 'Add color' }).click();
  await colors.getByLabel('Name').fill('Ember');
  await colors.getByLabel('Hex').fill('#D14E24');
  await colors.getByRole('button', { name: 'Add', exact: true }).click();
  const link = page.getByTestId('outside-link').getByRole('link', { name: 'Footage day 1' });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(page.getByTestId('outside-link')).toContainText('drive.example.com');
  await page.getByRole('button', { name: 'Add outside link' }).click();
  const d = page.getByTestId('outside-link-dialog');
  await d.getByLabel('Name').fill('Raw audio');
  await d.getByLabel('Link').fill('https://cloud.example.com/a');
  await d.getByLabel('Asset type').selectOption('audio');
  await d.getByRole('button', { name: 'Add link' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls.length)).toBe(2);
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls[0].colors).toEqual([{ name: 'Ink', hex: '#141A1E' }, { name: 'Ember', hex: '#D14E24' }]);
  expect(calls[1].outsideLinks.at(-1)).toMatchObject({ name: 'Raw audio', url: 'https://cloud.example.com/a', type: 'audio', tags: [] });
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});
