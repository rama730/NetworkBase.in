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
