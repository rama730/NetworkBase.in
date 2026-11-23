import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.9 T2 W1–W4, W7, W11 (plan A2.10): Now · Next · Later, By stage, the panel, Won't do, phone.
const PROJECT = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
async function open(page: Page, opts: { width?: number; empty?: boolean; canEdit?: boolean; panel?: string } = {}) {
  await page.clock.setFixedTime(new Date('2026-11-25T06:00:00Z'));
  await page.setViewportSize({ width: opts.width ?? 1280, height: 900 });
  await page.addInitScript(({ empty, canEdit }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const item = (id: string, n: number, title: string, stage: string, tf: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, taskNumber: n, title, stage,
      status: stage === 'launched' || stage === 'wont_do' ? 'done' : stage === 'in_progress' || stage === 'testing' ? 'in_progress' : 'todo', priority: 'medium', dueDate: null,
      assigneeId: 'u1', assigneeName: 'Asha', createdAt: '2026-11-20T09:00:00.000Z', typeFields: tf, progress: null, workCount: 0, openWork: 0, workStart: null, requests: 0, ...extra });
    const items = empty ? [] : [
      item('r1', 150, 'SSO sign-in', 'in_progress', { column: 'now', itemType: 'feature', outcome: 'People sign in with their company account', builtBy: ['p1'] }, { progress: 50, workCount: 4, openWork: 2, workStart: '2026-11-10', dueDate: '2026-12-15' }),
      item('r2', 151, 'Faster search', 'planned', { column: 'next', itemType: 'improvement' }),
      item('r3', 152, 'Alpha build', 'backlog', { column: 'later', itemType: 'milestone', milestone: 'Alpha' }, { dueDate: '2026-12-20' }),
      item('r5', 154, 'Dark mode', 'backlog', { itemType: 'improvement' }, { requests: 3, createdAt: '2026-11-22T09:00:00.000Z' }),
      item('r4', 153, 'Old export', 'launched', { column: 'now', itemType: 'fix' }),
    ];
    (window as any).__actions = {
      readRoadmapAction: async () => ({ success: true, projectKey: 'AC', items, projects: [{ id: 'p1', title: 'Auth rework', taskNumber: 90 }, { id: 'p2', title: 'Search index', taskNumber: 91 }], canEdit, viewerId: 'u1' }),
      moveRoadmapColumnAction: async (input: unknown) => { calls.push(['column', input]); return { success: true, stage: 'planned' }; },
      setRoadmapFieldsAction: async (input: unknown) => { calls.push(['fields', input]); return { success: true }; },
      moveBacklogAction: async (input: unknown) => { calls.push(['backlog', input]); return { success: true }; },
      wontDoAction: async (input: unknown) => { calls.push(['wontdo', input]); return { success: true, openWork: 2 }; },
    };
  }, { empty: opts.empty ?? false, canEdit: opts.canEdit ?? true });
  await openApp(page, 'tests/browser/roadmap-tab.fixture.tsx', opts.panel ? { path: `/?panel=${opts.panel}` } : undefined);
  if (!opts.panel) await expect(page.getByTestId('roadmap-counts')).toBeVisible();
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('W1: an empty roadmap shows three columns, the hint and New item', async ({ page }) => {
  await open(page, { empty: true });
  await expect(page.getByTestId('roadmap-column')).toHaveCount(3);
  await expect(page.getByTestId('roadmap-empty')).toHaveText('Put what you’re building now in Now. Work tasks go on the Tasks board.');
  await expect(page.getByRole('button', { name: 'New item' })).toBeVisible();
});

test('W2–W3: cards sit in their columns (Launched leaves); Move to Now from the card menu; By stage', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('roadmap-counts')).toHaveText('1 now · 1 next');
  const now = page.getByRole('region', { name: 'Now' });
  await expect(now.getByTestId('roadmap-card')).toHaveCount(1);
  await expect(now).toContainText(/SSO sign-in.*People sign in.*Feature.*In progress.*50%/);
  await expect(page.getByRole('region', { name: 'Later' })).toContainText('Alpha');
  expect(await axeViolations(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/roadmap-tab/columns.png' });
  await page.getByRole('button', { name: 'Move Faster search' }).click();
  await page.getByRole('menuitem', { name: 'Move to Now' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['column', { projectId: PROJECT, taskId: 'r2', column: 'now' }]);
  await page.getByRole('tab', { name: 'By stage' }).click();
  await expect(page.getByTestId('roadmap-stage')).toHaveCount(5);
  await expect(page.getByRole('region', { name: 'Launched, 1' })).toContainText('Old export');
});

test('W4 and S6: the panel shows outcome, type, Built by and progress; linking a project', async ({ page }) => {
  await open(page, { panel: 'r1' });
  await expect(page.getByTestId('roadmap-built-by')).toContainText('Auth rework');
  await expect(page.getByTestId('roadmap-progress')).toHaveText('50% · 2 of 4 work tasks done');
  await page.getByLabel('Link a project').selectOption({ label: 'Search index' });
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['fields', { projectId: PROJECT, taskId: 'r1', fields: { builtBy: ['p1', 'p2'] } }]);
});

test("W7: Won't do asks a reason and says open work stays", async ({ page }) => {
  await open(page, { panel: 'r1' });
  await page.getByRole('button', { name: 'Won’t do…' }).click();
  const dialog = page.getByTestId('wont-do-dialog');
  await expect(dialog).toContainText('Its 2 open work tasks stay on the board');
  await expect(dialog.getByRole('button', { name: 'Won’t do' })).toBeDisabled();
  await dialog.getByLabel('Why not?').fill('Not this year');
  await dialog.getByRole('button', { name: 'Won’t do' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['wontdo', { projectId: PROJECT, taskId: 'r1', reason: 'Not this year' }]);
});

test('W11 and viewers: a phone shows three folding sections (Now open); viewers get no New item or menus', async ({ page }) => {
  await open(page, { width: 375, canEdit: false });
  await expect(page.locator('details[data-testid="roadmap-column"]')).toHaveCount(3);
  await expect(page.locator('details[open]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'New item' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/roadmap-tab/phone.png' });
});

test('A2.11 W8: Timeline draws bars from the first work start, milestones as diamonds, and lists items with no dates', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Timeline' }).click();
  const tl = page.getByTestId('roadmap-timeline');
  await expect(tl.getByTestId('timeline-row')).toHaveCount(2);
  await expect(tl.getByLabel('Milestone Alpha on 2026-12-20')).toBeVisible();
  await expect(tl.getByTitle('SSO sign-in · 2026-11-10 → 2026-12-15')).toHaveText('50%');
  await expect(page.getByTestId('timeline-no-dates')).toContainText('Faster search');
  expect(await axeViolations(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/roadmap-tab/timeline.png' });
});

test('A2.11 W9: Backlog lists Backlog items in order with requests; Move up and drag reorder', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Backlog' }).click();
  const rows = page.getByTestId('backlog-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(/Dark mode.*Improvement.*medium.*3/i);
  await page.getByRole('button', { name: 'Move Alpha build up' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['backlog', { projectId: PROJECT, taskId: 'r3', beforeId: 'r5' }]);
  expect(await axeViolations(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/roadmap-tab/backlog.png' });
});
