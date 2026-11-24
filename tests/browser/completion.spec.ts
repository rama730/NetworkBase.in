import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B2.1b (report 31.2 C1 calls 5–6).
async function open(page: Page, view: string, staff = true, open = true) {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.addInitScript((s) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const learners = [
      { id: 'u1', name: 'A. Rao', required: 3, approved: 3, attendance: 92, minimum: 80, meets: true, reasons: [], record: null },
      { id: 'u2', name: 'K. Shah', required: 3, approved: 2, attendance: 70, minimum: 80, meets: false, reasons: ['1 assignment not approved', 'Attendance 70%, needs 80%'], record: null },
    ];
    (window as any).__actions = {
      readCompletionAction: async () => (s.staff
        ? { success: true, staff: true, canRecord: true, termEnd: '2027-03-28', open: s.open, learners, line: null }
        : { success: true, staff: false, canRecord: false, termEnd: '2027-03-28', open: true, line: null,
          learners: [{ ...learners[0], record: { completed: true, byRule: true, reason: null, decidedAt: '2027-03-29T10:00:00Z' } }] }),
      readCompletionLineAction: async () => 'Completion 24 of 28',
      recordCompletionAction: async (_o: string, d: unknown) => { calls.push(d); return { success: true, completed: 2, notCompleted: 0 }; },
    };
  }, { staff, open });
  await openApp(page, 'tests/browser/completion.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('staff: each learner against the rule; overriding asks why and sends the reason', async ({ page }) => {
  await open(page, 'list');
  const rows = page.getByTestId('completion-row');
  await expect(rows.first()).toContainText('3/3 approved · 92%');
  await expect(rows.nth(1)).toContainText('1 assignment not approved · Attendance 70%, needs 80%');
  await expect(page.getByLabel('Completion for K. Shah')).toHaveValue('no');
  await page.getByLabel('Completion for K. Shah').selectOption('yes');
  await page.getByLabel('Why, for K. Shah').fill('Medical leave; work seen in person');
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Record completion' }).click();
  await expect.poll(() => calls(page)).toEqual([[{ userId: 'u1', completed: true, reason: null }, { userId: 'u2', completed: true, reason: 'Medical leave; work seen in person' }]]);
});

test('before the end date there is nothing to record; a learner sees Completed and the profile line; Overview shows the count', async ({ page }) => {
  await open(page, 'list', true, false);
  await expect(page.getByTestId('completion')).toContainText('Recording opens on Mar 28, 2027.');
  await expect(page.getByRole('button', { name: 'Record completion' })).toHaveCount(0);
  await open(page, 'list', false);
  await expect(page.getByTestId('my-completion')).toContainText('Completed');
  await expect(page.getByTestId('my-completion')).toContainText('verified entry');
  await open(page, 'line');
  await expect(page.getByTestId('completion-line')).toHaveText('Completion 24 of 28');
});
