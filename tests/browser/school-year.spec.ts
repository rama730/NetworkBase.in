import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B3.1a (report 32.2 S1).
async function open(page: Page, view: string, school = true) {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.addInitScript((s) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const year = { name: '2026–27', weekStart: 'mon', terms: [{ name: 'Term 1', start: '2026-09-02', end: '2026-10-30' }], days: [{ name: 'Half-term', kind: 'holiday', start: '2026-10-26', end: '2026-10-30' }] };
    const months = [{ month: '2026-09', days: [{ day: '2026-09-01', kind: 'outside' }, { day: '2026-09-02', kind: 'school' }, { day: '2026-09-05', kind: 'weekend' }] }, { month: '2026-10', days: [{ day: '2026-10-26', kind: 'holiday' }] }];
    (window as any).__actions = {
      readSchoolYearAction: async () => ({ success: true, isSchool: s, canEdit: s, year, today: '2026-10-08', months, week: { term: 'Term 1', week: 6, weeks: 9 }, holiday: { name: 'Half-term', start: '2026-10-26', days: 18 },
        thisWeek: [{ day: '2026-10-09', kind: 'staff' }] }),
      saveSchoolYearAction: async (_o: string, input: unknown) => { calls.push(['save', input]); return { success: true, classes: 4 }; },
    };
  }, school);
  await openApp(page, 'tests/browser/school-year.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Year view: terms, the term week and next holiday in words, a legend, and each day labelled', async ({ page }) => {
  await open(page, 'year');
  const y = page.getByTestId('year-view');
  await expect(y).toContainText('Term 1 · Week 6 of 9 · Half-term in 18 days');
  await expect(y.getByRole('list', { name: 'Legend' })).toContainText('Holiday');
  await expect(y.getByRole('cell', { name: 'Mon, Oct 26: Holiday' })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test('Settings → School year adds a staff day and saves; a class shows This week at school', async ({ page }) => {
  await open(page, 'settings');
  const s = page.getByTestId('school-year-settings');
  await s.getByRole('button', { name: 'Add a day' }).click();
  await s.getByLabel('Day 2 name').fill('INSET');
  await s.getByLabel('Day 2 kind').selectOption('staff');
  await s.getByLabel('Day 2 start').fill('2026-10-09');
  await s.getByLabel('Day 2 end').fill('2026-10-09');
  await s.getByRole('button', { name: 'Save school year' }).click();
  await expect.poll(async () => (await calls(page))[0]?.[1]?.days?.[1]).toEqual({ name: 'INSET', kind: 'staff', start: '2026-10-09', end: '2026-10-09' });
  await open(page, 'week', false);
  await expect(page.getByTestId('this-week-at-school')).toContainText(/Term 1 · Week 6 of 9\s*Fri, Oct 9 · Staff day, no classes\s*Half-term in 18 days/);
});
