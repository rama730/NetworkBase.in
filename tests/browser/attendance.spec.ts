import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 30.7 W6 (plan B1.4a).
async function open(page: Page, view: string, role = 'teacher', on = true, locked = false) {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.addInitScript((s) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const students = s.role === 'student'
      ? [{ id: 'u2', name: 'K. Shah', records: {}, notes: {}, percent: 50, below: true, canMiss: 0 }]
      : [{ id: 'u1', name: 'A. Rao', records: { '2027-02-03T10:30': 'present', '2027-02-05T10:30': 'late' }, notes: {}, percent: 100, below: false, canMiss: 3 },
        { id: 'u2', name: 'K. Shah', records: { '2027-02-03T10:30': 'present', '2027-02-05T10:30': 'absent' }, notes: { '2027-02-10T10:30': 'fever' }, percent: 50, below: true, canMiss: 0 }];
    (window as any).__actions = {
      readAttendanceAction: async () => ({ success: true, role: s.role, canWrite: true, settings: { on: s.on, lateCountsPresent: true, lateAfterMinutes: 10, absenceNotes: true, checkInCode: true, minimum: 75, minimumLocked: s.locked ?? false },
        sessions: [{ key: '2027-02-03T10:30', start: '2027-02-03T10:30', status: 'on' }, { key: '2027-02-05T10:30', start: '2027-02-05T10:30', status: 'on' }, { key: '2027-02-10T10:30', start: '2027-02-10T10:30', status: 'on' }],
        today: { key: '2027-02-10T10:30', start: '2027-02-10T10:30' }, students }),
      saveAttendanceAction: async (_o: string, key: string, marks: unknown) => { calls.push(['save', key, marks]); return { success: true, saved: 2 }; },
      saveAttendanceSettingsAction: async (_o: string, v: unknown) => { calls.push(['settings', v]); return { success: true }; },
      exportRegisterAction: async () => { calls.push(['export']); return { success: true, csv: 'Student' }; },
      startCheckInAction: async () => { calls.push(['code']); return { success: true, code: '4821', expiresAt: '2027-02-10T10:45:00Z', session: '2027-02-10T10:30' }; },
      checkInAction: async (_o: string, code: string) => { calls.push(['checkin', code]); return { success: true, status: 'present' }; },
      sendAbsenceNoteAction: async (_o: string, key: string, note: string) => { calls.push(['note', key, note]); return { success: true }; },
    };
  }, { role, on, locked });
  await openApp(page, 'tests/browser/attendance.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('the grid: letters with words, % and Below minimum; a legend', async ({ page }) => {
  await open(page, 'grid');
  const rows = page.getByTestId('attendance-row');
  await expect(rows.first()).toContainText(/A\. Rao\s*P\s*L/);
  await expect(rows.nth(1)).toContainText('Below 75%');
  await expect(page.getByLabel('Late').first()).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test('Take attendance opens unmarked, Mark all present, change one, Save with the count; absence notes show', async ({ page }) => {
  await open(page, 'grid');
  await page.getByRole('button', { name: 'Take attendance', exact: true }).click();
  const sheet = page.getByTestId('take-attendance');
  await expect(sheet).toContainText('Notified: fever');
  await expect(sheet.getByRole('radio', { checked: true })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Mark all present' }).click();
  await sheet.getByRole('radiogroup', { name: 'K. Shah' }).getByRole('radio', { name: 'Absent' }).click();
  await page.getByRole('button', { name: /^Save · 1 present, 0 late, 1 absent, 0 excused$/ }).click();
  await expect.poll(() => calls(page)).toEqual([['save', '2027-02-10T10:30', [{ userId: 'u1', status: 'present' }, { userId: 'u2', status: 'absent' }]]]);
});

test('a student sees their own % and how many more they can miss; off shows the explainer', async ({ page }) => {
  await open(page, 'mine', 'student');
  await expect(page.getByTestId('your-attendance')).toContainText('50% · minimum 75% · don’t miss another class');
  await open(page, 'grid', 'teacher', false);
  await expect(page.getByText('Attendance is off')).toBeVisible();
});

test('Settings → Attendance saves', async ({ page }) => {
  await open(page, 'settings');
  await page.getByLabel('Minimum attendance, percent').fill('80');
  await page.getByRole('button', { name: 'Save attendance settings' }).click();
  await expect.poll(() => calls(page)).toEqual([['settings', { on: true, lateCountsPresent: true, lateAfterMinutes: 10, absenceNotes: true, checkInCode: true, minimum: 80, minimumLocked: false }]]);
});

test('B1.4b: staff show a check-in code; a student checks in with it and sends an absence note', async ({ page }) => {
  await open(page, 'grid');
  await page.getByRole('button', { name: 'Check-in code' }).click();
  await expect(page.getByTestId('check-in-code')).toContainText('4821');
  await open(page, 'mine', 'student');
  await page.getByRole('button', { name: 'I’m here' }).click();
  await page.getByLabel('Check-in code').fill('4821');
  await page.getByRole('button', { name: 'Check in' }).click();
  await page.getByRole('button', { name: 'Send an absence note' }).click();
  await page.getByLabel('Absence note').fill('Fever');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => calls(page)).toEqual([['checkin', '4821'], ['note', '2027-02-10T10:30', 'Fever']]);
});

test('B1.4b: a school minimum is locked in the class settings', async ({ page }) => {
  await open(page, 'settings', 'teacher', true, true);
  await expect(page.getByLabel('Minimum attendance, percent')).toBeDisabled();
  await expect(page.getByTestId('minimum-set-by-school')).toContainText('Set by your school');
});
