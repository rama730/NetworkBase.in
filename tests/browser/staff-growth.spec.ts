import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B3.5a–b (report 32.6 calls 3–5, 8).
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readStaffGrowthSettingsAction: async () => ({ success: true, reportsTo: {}, headings: ['Teaching and learning'], staff: [{ id: 'h', name: 'Head Teacher' }, { id: 'a', name: 'Asha Rao' }] }),
      saveStaffGrowthSettingsAction: async (_s: string, v: unknown) => { calls.push(['settings', v]); return { success: true }; },
      readGrowthAction: async () => ({ success: true, person: 'a', personName: 'Asha Rao', mine: true, headings: ['Teaching and learning'], manager: 'Head Teacher', myReports: [],
        goals: [{ id: 'g1', kind: 'goal', title: 'Better questions', body: {}, created_at: '2026-09-02', by: 'Asha Rao' }], review: { id: 'r', kind: 'review', title: 'Year review 2026', body: { manager: 'Strong progress' }, created_at: '2026-09-02', by: 'Head Teacher' }, log: [] }),
      readGrowthCountsAction: async () => ({ success: false, error: 'x' }),
      saveGrowthAction: async (_s: string, _p: unknown, v: unknown) => { calls.push(['save', v]); return { success: true }; },
    };
  });
  await openApp(page, 'tests/browser/school-year.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Settings → Staff growth: Reports to per person and the review headings', async ({ page }) => {
  await open(page, 'growth-settings');
  const s = page.getByTestId('staff-growth-settings');
  await s.getByLabel('Asha Rao reports to').selectOption({ label: 'Head Teacher' });
  expect(await axeViolations(page)).toEqual([]);
  await s.getByRole('button', { name: 'Save staff growth' }).click();
  await expect.poll(async () => ((await calls(page))[0]?.[1] as { reportsTo: Record<string, string> })?.reportsTo).toEqual({ a: 'h' });
});

test('Growth: my goals, the year review in words (my parts editable, the line manager’s read-only), the log', async ({ page }) => {
  await open(page, 'growth');
  const v = page.getByTestId('growth-view');
  await expect(v).toContainText('Line manager: Head Teacher');
  await expect(v.getByRole('listitem').first()).toHaveText('Better questions');
  const r = page.getByTestId('year-review');
  await expect(r).toContainText('words only, no ratings');
  await expect(r).toContainText('Strong progress');
  await r.getByLabel('Self-reflection').fill('More wait time after questions');
  expect(await axeViolations(page)).toEqual([]);
  await r.getByRole('button', { name: 'Save the review' }).click();
  await expect.poll(async () => ((await calls(page)).at(-1) as [string, { body: Record<string, string> }])?.[1]?.body).toEqual({ reflection: 'More wait time after questions' });
});
