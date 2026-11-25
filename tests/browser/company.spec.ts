import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B4.1c (report 33.2 calls 5, 7).
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readCompanyAboutAction: async () => ({ success: true, admin: true, inside: true, publicValues: false, publicOffices: false,
        values: [{ name: 'Candour', line: 'Say it kindly' }], offices: [{ name: 'HQ', city: 'Pune', zone: 'Asia/Kolkata' }],
        teams: [{ id: 't1', title: 'Sales', slug: 'sales', line: 'We sell', manager: 'Priya Shah', members: 5 }] }),
      readWhatsNewAction: async () => ({ success: true, items: [
        { kind: 'announcement', id: 'a1', text: 'Office closed Friday', at: '2026-11-24T09:00:00Z', slug: null },
        { kind: 'updated', id: 'travel', text: 'Travel policy', at: '2026-11-23T09:00:00Z', slug: 'travel' }] }),
      readNeedsReviewAction: async () => ({ success: true, total: 2, owners: [{ owner: 'Priya Shah', pages: [{ slug: 'travel', title: 'Travel policy', reviewBy: '2026-11-01' }] }, { owner: 'No owner', pages: [{ slug: 'exp', title: 'Expenses', reviewBy: '2026-10-01' }] }] }),
      readCompanyWidePagesAction: async () => ({ success: true, pages: [{ id: 'd1', title: 'Shipping', team: 'Engineering', archived: false }, { id: 'd2', title: 'Old guide', team: 'Ops', archived: true }] }),
      readCompanyWidePageAction: async () => ({ success: true, title: 'Shipping', team: 'Engineering', archived: false, content: '# Shipping\n\nHow we ship.' }),
      readInCompanyAction: async () => ({ success: true, inCompany: true }),
      setCompanyWideAction: async (p: string, v: unknown) => { calls.push(['share', p, v]); return { success: true }; },
      saveCompanyAboutAction: async (_o: string, v: unknown) => { calls.push(['save', v]); return { success: true }; },
    };
  });
  await openApp(page, 'tests/browser/company.fixture.tsx', { path: `/?view=${view}` });
}

test('About: Values, Offices and Our teams (About line, manager, member count)', async ({ page }) => {
  await open(page, 'about');
  await expect(page.getByTestId('company-values')).toContainText('Candour · Say it kindly');
  await expect(page.getByTestId('company-offices')).toContainText('HQ · Pune · Asia/Kolkata');
  await expect(page.getByTestId('our-teams')).toContainText('Sales');
  await expect(page.getByTestId('our-teams')).toContainText('Priya Shah · 5 members');
  expect(await axeViolations(page)).toEqual([]);
});

test('Settings → Company: add a value, show values to visitors, save', async ({ page }) => {
  await open(page, 'settings');
  const s = page.getByTestId('company-settings');
  await s.getByRole('button', { name: 'Add a value' }).click();
  await s.getByLabel('Value 2', { exact: true }).fill('Ownership');
  await s.getByLabel('Show values to visitors').check();
  expect(await axeViolations(page)).toEqual([]);
  await s.getByRole('button', { name: 'Save company' }).click();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__calls))[0]?.[1]).toEqual({
    values: [{ name: 'Candour', line: 'Say it kindly' }, { name: 'Ownership', line: '' }], offices: [{ name: 'HQ', city: 'Pune', zone: 'Asia/Kolkata' }], publicValues: true, publicOffices: false });
});

test("Overview: What's new (announcements, New/Updated pages) and Needs review by owner", async ({ page }) => {
  await open(page, 'overview');
  const w = page.getByTestId('whats-new');
  await expect(w).toContainText('Office closed Friday');
  await expect(w).toContainText('Updated');
  await expect(w.getByRole('link', { name: 'Travel policy' })).toHaveAttribute('href', '/org/acme?tab=docs&doc=travel');
  const r = page.getByTestId('needs-review');
  await expect(r).toContainText('Needs review · 2 pages');
  await expect(r).toContainText('Priya Shah: Travel policy');
  await expect(r).toContainText('No owner: Expenses');
  expect(await axeViolations(page)).toEqual([]);
});

test('Documents: From teams lists company-wide team pages and opens one; a team page shares with the company', async ({ page }) => {
  await open(page, 'teams');
  const f = page.getByTestId('from-teams');
  await expect(f).toContainText('Engineering');
  await expect(f).toContainText('From an archived team');
  expect(await axeViolations(page)).toEqual([]);
  await f.getByRole('button', { name: /Shipping/ }).click();
  await expect(page.getByRole('dialog')).toContainText('How we ship.');
  await expect(page.getByRole('dialog')).toContainText('From Engineering · company-wide');
  await page.keyboard.press('Escape');
  await page.getByTestId('company-wide-toggle').click();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__calls)).find((c: unknown[]) => c[0] === 'share')?.[2]).toEqual({ docSlug: 'shipping', on: true });
});
