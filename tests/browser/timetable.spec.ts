import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B3.4a (report 32.5 calls 1–4).
const settings = { patterns: [{ name: 'School day', days: [1, 2, 3, 4, 5], periods: [{ key: 'P1', start: '09:00', end: '10:00', kind: 'lesson' }, { key: 'Break', start: '10:00', end: '10:20', kind: 'break' }, { key: 'P2', start: '10:20', end: '11:20', kind: 'lesson' }] }], weekAB: false, weekAStart: null };
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript((s) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const mine = [{ id: '1', day: 2, period: 'P1', week: null, className: '6A', courseId: null, teacherId: 'me', teacher: 'Asha Rao', room: 'S1' }];
    (window as any).__actions = {
      readTimetableAction: async () => ({ success: true, leader: true, settings: s, today: '2026-09-08', mine,
        yourDay: [{ ...s.patterns[0].periods[0], slots: mine }, { ...s.patterns[0].periods[1], slots: [] }, { ...s.patterns[0].periods[2], slots: [] }],
        covers: [], duties: [], all: [...mine, { id: '2', day: 3, period: 'P2', week: null, className: '7B', courseId: null, teacherId: 'rl', teacher: 'Ravi Lee', room: 'S2' }] }),
      readCoverOnlyAction: async () => ({ success: true, viewers: [] }),
      saveTimetableSettingsAction: async (_s: string, v: unknown) => { calls.push(['save', v]); return { success: true }; },
      importTimetableAction: async (_s: string, rows: unknown[]) => { calls.push(['import', rows.length]); return { success: true, added: rows.length, unmatched: [] }; },
    };
  }, settings);
  await openApp(page, 'tests/browser/school-year.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Settings → Timetable: periods as lines, save the day; import a CSV with a preview', async ({ page }) => {
  await open(page, 'tt-settings');
  const s = page.getByTestId('timetable-settings');
  await expect(s.getByLabel('Day pattern 1 periods')).toHaveValue('P1 09:00-10:00\nBreak 10:00-10:20 break\nP2 10:20-11:20');
  await s.getByLabel('Day pattern 1 periods').fill('P1 09:00-10:00\nLunch 12:00-12:40 lunch');
  await s.getByRole('button', { name: 'Save the school day' }).click();
  await expect.poll(async () => ((await calls(page))[0]?.[1] as { patterns: Array<{ periods: Array<{ kind: string }> }> })?.patterns[0]?.periods.map((p) => p.kind)).toEqual(['lesson', 'lunch']);
  await s.getByLabel('Timetable CSV').setInputFiles({ name: 't.csv', mimeType: 'text/csv', buffer: Buffer.from('day,period,class,teacher,room\nTue,P1,6A,Asha Rao,S1\nWed,P7,6B,Asha Rao,S1') });
  await expect(page.getByTestId('timetable-preview')).toContainText('1 rows ready · 1 with a problem: No period called P7 in the school day');
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
  await s.getByRole('button', { name: 'Import 1 slots' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['import', 1]);
});

test('Timetable view: Your day with break rows and Free periods; a leader picks another teacher', async ({ page }) => {
  await open(page, 'timetable');
  const day = page.getByTestId('your-day');
  await expect(day).toContainText(/09:00–10:00\s*P1\s*6A · S1/);
  await expect(day).toContainText('Break');
  await expect(day).toContainText(/P2\s*Free/);
  await page.getByRole('combobox').selectOption({ label: 'Ravi Lee' });
  await expect(page.getByRole('region', { name: 'Week timetable' })).toContainText('7B · S2');
  expect(await axeViolations(page)).toEqual([]);
});
