import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B4.3 (report 33.4).
const goals = [
  { id: 'g1', title: 'Hit $500k APAC bookings', owner: null, team: null, teamId: 'o', progress: 72, status: 'on_track', contributesTo: null },
  { id: 'g2', title: 'Reduce churn to 8%', owner: null, team: null, teamId: 'o', progress: 40, status: 'off_track', contributesTo: null },
  { id: 't1', title: '40 new logos', owner: null, team: 'Sales APAC', teamId: 's', progress: 65, status: 'at_risk', contributesTo: 'g1' },
];
const projects = [
  { id: 'p1', title: 'Singapore launch', slug: 'sg', masked: false, supports: 't1', start: '2026-09-01', end: '2026-12-15', status: { status: 'at_risk', line: 'Hiring slipped two weeks', at: '2026-11-14T09:00:00Z' }, done: 7, total: 12 },
  { id: 'private-1', title: 'Private project', slug: null, masked: true, supports: 'g2', start: null, end: null, status: { status: 'on_track', line: 'Going well', at: '2026-11-20T09:00:00Z' }, done: 0, total: 0 },
  { id: 'p3', title: 'Partner programme', slug: 'pp', masked: false, supports: null, start: null, end: null, status: null, done: 0, total: 0 },
];
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(({ goals, projects }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readCompanyGoalsAction: async () => ({ success: true, admin: true, period: '2026-Q4', label: 'Q4 2026', range: { start: '2026-10-01', end: '2026-12-31' }, goals, projects, notLinked: ['Partner programme'], goalsDoc: 'goals-2026-q4' }),
      readProjectGoalLineAction: async () => ({ success: true, project: { lead: true, member: true, supports: 't1', start: '2026-09-01', end: '2026-12-15', status: { status: 'at_risk', line: 'Hiring slipped', at: '2026-11-14T09:00:00Z' }, goals: goals.map((g) => ({ id: g.id, title: g.title, team: g.team })), label: 'Q4 2026' } }),
      postProjectStatusAction: async (p: string, v: unknown) => { calls.push(['status', p, v]); return { success: true }; },
      setProjectSupportsAction: async (p: string, g: string | null) => { calls.push(['supports', p, g]); return { success: true }; },
      setProjectDatesAction: async (p: string, v: unknown) => { calls.push(['dates', p, v]); return { success: true }; },
    };
  }, { goals, projects });
  await openApp(page, 'tests/browser/company-goals.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Goals: company goals Off track first, team goals under the goal they contribute to, projects with status; Not linked for admins', async ({ page }) => {
  await open(page, 'projects');
  await page.getByRole('tab', { name: 'Goals' }).click();
  const tree = page.getByRole('tree', { name: 'Company goals' });
  const top = tree.locator(':scope > li');
  await expect(top.first()).toContainText('Reduce churn to 8%');
  const apac = tree.getByRole('treeitem', { name: /Hit \$500k APAC bookings/ });
  await expect(apac.getByRole('treeitem', { name: /40 new logos, At risk, 65%/ })).toContainText('Singapore launch');
  await expect(apac).toContainText('“Hiring slipped two weeks”');
  await expect(tree).toContainText('Private project');
  await expect(page.getByTestId('not-linked')).toContainText('Partner programme');
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole('tab', { name: 'Timeline' }).click();
  const rows = page.getByTestId('company-timeline').locator('tbody tr');
  await expect(rows.first()).toContainText('Singapore launch');
  await expect(rows.first()).toContainText('58%');
  await expect(rows.first()).toContainText('40 new logos');
  await expect(rows.nth(2)).toContainText('No dates');
});

test('Company goals card and the project header line: Supports, dates and Post status', async ({ page }) => {
  await open(page, 'card');
  await expect(page.getByTestId('company-goals-card')).toContainText('Company goals · Q4 2026');
  await expect(page.getByTestId('company-goals-card')).not.toContainText('40 new logos');
  await open(page, 'line');
  const line = page.getByTestId('project-goal-line');
  await expect(line).toContainText('At risk');
  await line.getByRole('button', { name: 'Post status' }).click();
  await page.getByLabel('Off track').check();
  await page.getByLabel('Status line').fill('Lost the lead engineer');
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect.poll(async () => (await calls(page))[0]).toEqual(['status', 'p1', { status: 'off_track', line: 'Lost the lead engineer' }]);
});
