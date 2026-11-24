import { expect, test } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 30.6 W5 (plan B1.8c).
test('the Theses table: student, title, supervisor, milestone with Overdue, words, and the no-supervision flag in words', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__actions = { readThesisCoordinatorAction: async () => ({ success: true, flagDays: 30, rows: [
      { workspaceId: 'w1', slug: 'gnn', title: 'Graph nets for traffic', student: 'A. Rao', supervisor: 'Dr Iyer', milestone: { title: 'Draft', due: '2027-03-30T23:59:00Z', overdue: false }, words: 18400, target: 40000, lastSupervision: '2027-03-02', daysSince: 3, noSupervision: false },
      { workspaceId: 'w2', slug: null, title: 'Low-power sensors', student: 'K. Shah', supervisor: null, milestone: { title: 'Lit review', due: '2027-01-10T23:59:00Z', overdue: true }, words: 2100, target: 40000, lastSupervision: '2027-01-11', daysSince: 45, noSupervision: true },
    ] }) };
  });
  await openApp(page, 'tests/browser/thesis-coordinator.fixture.tsx');
  const rows = page.getByTestId('thesis-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('18.4K / 40K');
  await expect(rows.nth(1)).toContainText('No supervisor');
  await expect(rows.nth(1)).toContainText('Overdue');
  await expect(rows.nth(1)).toContainText('45 days');
  expect(await axeViolations(page)).toEqual([]);
});
