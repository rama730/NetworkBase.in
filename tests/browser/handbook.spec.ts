import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B4.1a (report 33.2 call 3).
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript((view) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      markOrgDocStillCorrectAction: async (o: string, d: string) => { calls.push(['still', o, d]); return { success: true, reviewBy: '2027-11-25' }; },
      saveHandbookSettingsAction: async (_o: string, v: unknown) => { calls.push(['settings', v]); return { success: true }; },
      readOrgDocsAction: async () => ({ success: true, data: { mode: 'org', orgId: 'o', orgTitle: 'Acme', orgSlug: 'acme', isAdmin: view === 'settings', isInside: true, memberCount: 80, signedIn: true, groups: [], docs: [], sprints: [], viewerId: 'u-me', reviewMonths: 0, people: [] } }),
    };
  }, view);
  await openApp(page, 'tests/browser/handbook.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('a handbook page shows its owner and Review by; its owner marks it Still correct; late pages are marked, not hidden', async ({ page }) => {
  await open(page, 'page');
  const line = page.getByTestId('doc-review-line');
  await expect(line).toContainText('Owner: Priya Shah');
  await expect(line).toContainText('Review by 2026-11-01');
  await expect(line).toContainText('Needs review');
  await expect(page.getByTestId('chips')).toContainText('Needs review');
  expect(await axeViolations(page)).toEqual([]);
  await line.getByRole('button', { name: 'Still correct' }).click();
  await expect.poll(async () => (await calls(page))[0]?.[0]).toBe('still');
});

test('Settings → Handbook: the review cycle is 6 or 12 months, or off', async ({ page }) => {
  await open(page, 'settings');
  const s = page.getByTestId('handbook-settings');
  await s.getByLabel('Review cycle').selectOption({ label: 'Every 12 months' });
  await expect.poll(async () => (await calls(page))[0]?.[1]).toEqual({ reviewMonths: 12 });
  expect(await axeViolations(page)).toEqual([]);
});
