import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B3.3c (report 32.4 calls 5, 6, 8).
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readHandInSettingsAction: async () => ({ success: true, canEdit: true, quietWeeks: [{ name: 'Report week', start: '2026-10-05', end: '2026-10-09' }] }),
      saveQuietWeeksAction: async (_s: string, w: unknown) => { calls.push(['save', w]); return { success: true }; },
      readDeadlinesAction: async () => ({ success: true, weeks: [{ week: '2026-10-05', count: 3, people: 12, heavy: true, quiet: 'Report week' }, { week: '2026-10-12', count: 1, people: 4, heavy: false, quiet: null }] }),
      checkDeadlineClashAction: async () => ({ success: true, week: '2026-10-05', quiet: 'Report week', deadlines: [{ id: 'a', title: 'Reports', due: '2026-10-07', people: 3 }] }),
    };
  });
  await openApp(page, 'tests/browser/school-year.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('quiet weeks: add one and save', async ({ page }) => {
  await open(page, 'quiet');
  const q = page.getByTestId('quiet-weeks');
  await q.getByRole('button', { name: 'Add a quiet week' }).click();
  await q.getByLabel('Quiet week 2 name').fill('Exam week');
  await q.getByLabel('Quiet week 2 start').fill('2026-12-07');
  await q.getByLabel('Quiet week 2 end').fill('2026-12-11');
  expect(await axeViolations(page)).toEqual([]);
  await q.getByRole('button', { name: 'Save quiet weeks' }).click();
  await expect.poll(async () => ((await calls(page))[0]?.[1] as unknown[])?.length).toBe(2);
});

test('Deadlines: counts per week with Heavy week and quiet weeks in words; the clash check is a list', async ({ page }) => {
  await open(page, 'deadlines');
  const rows = page.getByTestId('deadline-week');
  await expect(rows.first()).toContainText(/Week of Oct 5\s*3 deadlines · 12 people\s*Heavy week\s*Quiet week: Report week/);
  await expect(rows.nth(1)).not.toContainText('Heavy week');
  expect(await axeViolations(page)).toEqual([]);
  await open(page, 'clash');
  const note = page.getByTestId('clash-note');
  await expect(note).toContainText('That’s in a quiet week: Report week.');
  await expect(note.getByRole('listitem')).toHaveText('Reports · Oct 7 · 3 people');
});
