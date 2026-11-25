import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B3.1c–d (report 32.2 calls 6, 7 and the Import preview).
async function open(page: Page, fixture: 'school-events' | 'school-year', view: string) {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const year = { name: '2026–27', weekStart: 'mon', terms: [{ name: 'Term 1', start: '2026-09-02', end: '2026-12-18' }], days: [] };
    (window as any).__actions = {
      readEventsAction: async () => ({ success: true, canAdd: true, isSchool: true, schoolId: 's', schoolTitle: null, items: [] }),
      readMeetingFeedAction: async () => ({ success: true, hasLink: false, since: null }),
      newMeetingFeedAction: async () => { calls.push(['feed']); return { success: true, path: '/api/feeds/meetings/abc' }; },
      importSchoolCalendarAction: async (_s: string, rows: unknown) => { calls.push(['import', rows]); return { success: true, days: 1, events: 1 }; },
      readSchoolYearAction: async () => ({ success: true, isSchool: true, canEdit: true, year, today: '2026-10-08', months: [], week: null, holiday: null, thisWeek: [] }),
      previewNextYearAction: async (_s: string, y: unknown) => { calls.push(['preview', y]); return { success: true, copy: [{ id: 'b', title: 'Staff briefing', date: '2027-09-07' }], offer: [{ id: 'p', title: 'Parents’ evening', from: '2026-10-13', date: '2027-10-12' }], cannot: [] }; },
      startNextYearAction: async (_s: string, _y: unknown, keep: string[]) => { calls.push(['start', keep]); return { success: true, added: 2, classes: 3 }; },
    };
  });
  await openApp(page, `tests/browser/${fixture}.fixture.tsx`, { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Import… previews each row with its kind and error; only good rows are imported', async ({ page }) => {
  await open(page, 'school-events', 'events');
  await page.getByRole('button', { name: 'Import…' }).click();
  await page.getByLabel('Calendar file').setInputFiles({ name: 'year.csv', mimeType: 'text/csv',
    buffer: Buffer.from('name,type,start,end\nWinter break,Holiday,2026-12-21,2027-01-01\nScience fair,,2027-03-04,\nBad,,2027-02-30,') });
  const rows = page.getByTestId('import-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText('Start isn’t a date');
  await page.getByLabel('Import Science fair as').selectOption('staff');
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Import 2 rows' }).click();
  await expect.poll(async () => ((await calls(page))[0]?.[1] as Array<{ name: string; kind: string }>)?.map((r) => [r.name, r.kind])).toEqual([['Winter break', 'holiday'], ['Science fair', 'staff']]);
});

test('Subscribe makes a personal calendar link', async ({ page }) => {
  await open(page, 'school-events', 'events');
  await page.getByRole('button', { name: 'Subscribe' }).click();
  await page.getByRole('button', { name: 'Get my link' }).click();
  await expect(page.getByLabel('Your calendar link')).toHaveValue(/\/api\/feeds\/meetings\/abc$/);
});

test('Start next year: terms a year on, a preview, one-offs ticked, then started', async ({ page }) => {
  await open(page, 'school-year', 'settings');
  await page.getByRole('button', { name: 'Start next year' }).click();
  const box = page.getByTestId('start-next-year');
  await expect(box.getByLabel('Term 1 start next year')).toHaveValue('2027-09-02');
  await box.getByLabel('Term 1 start next year').fill('2027-08-31');
  await box.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('next-year-preview')).toContainText('1 repeating event moves on their own: Staff briefing.');
  await box.getByLabel(/Parents’ evening/).uncheck();
  expect(await axeViolations(page)).toEqual([]);
  await box.getByRole('button', { name: 'Start next year' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['start', []]);
});
