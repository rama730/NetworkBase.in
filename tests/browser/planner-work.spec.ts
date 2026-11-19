import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.5 T1 (plan A1.3): projects grouped by stage with completion; the Work tab adds and removes work with Undo
// and opens New with Part of; completing with open work asks Leave them or Move them to the Backlog.
async function open(page: Page, width = 1280, readOnly = false) {
  await page.clock.setFixedTime(new Date('2026-11-20T10:00:00'));
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((readOnly) => {
    (window as any).__readOnly = readOnly;
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const work = [
      { id: 'a', taskNumber: 1, title: 'Design', status: 'done', stage: null, itemType: 'task', dueDate: null, assigneeId: null, sprintId: null },
      { id: 'b', taskNumber: 2, title: 'Build', status: 'todo', stage: null, itemType: 'task', dueDate: '2026-12-10T00:00:00.000Z', assigneeId: null, sprintId: null },
    ];
    (window as any).__actions = {
      readProjectsAction: async () => ({ success: true, projectKey: 'WT', deps: [{ taskId: 'p1', blockedById: 'p3' }], projects: [
        { id: 'p1', taskNumber: 4, title: 'Website relaunch', stage: 'in_progress', status: 'in_progress', priority: 'high', assigneeId: 'u1', startDate: '2026-12-02T00:00:00.000Z', dueDate: '2026-12-20T00:00:00.000Z', completion: { percent: 50, source: 'work' } },
        { id: 'p2', taskNumber: 5, title: 'Pricing', stage: 'not_started', status: 'todo', priority: 'medium', assigneeId: null, startDate: null, dueDate: null, completion: { percent: 0, source: 'none' } },
        { id: 'p3', taskNumber: 6, title: 'Design system', stage: 'planning', status: 'in_progress', priority: 'medium', assigneeId: 'u2', startDate: '2026-11-02T00:00:00.000Z', dueDate: '2026-11-17T00:00:00.000Z', completion: { percent: 100, source: 'work' } },
      ] }),
      assignTaskAction: async (id: string, assigneeId: string | null) => { calls.push(['assign', id, assigneeId]); return { success: true }; },
      updateTaskFieldAction: async (id: string, field: string, value: unknown) => { calls.push(['field', id, field, value]); return { success: true }; },
      setTaskDatesAction: async (input: { taskId: string; dueDate?: string }) => { calls.push(['dates', input.taskId, input.dueDate?.slice(0, 10)]); return { success: true, conflicts: [], toShift: [], days: 0 }; },
      readProjectWorkAction: async () => ({ success: true, projectKey: 'WT', work: work.map((x) => ({ ...x })), completion: { percent: Math.round(100 * work.filter((x) => x.status === 'done').length / Math.max(1, work.length)), source: 'work' } }),
      setPartOfAction: async (input: { taskIds: string[]; partOfId: string | null }) => {
        calls.push(['partOf', input.taskIds, input.partOfId]);
        if (input.partOfId) work.push({ id: 'c', taskNumber: 9, title: 'Write the copy', status: 'todo', stage: null, itemType: 'task', dueDate: null, assigneeId: null, sprintId: null });
        else work.splice(work.findIndex((x) => input.taskIds.includes(x.id)), 1);
        return { success: true, count: 1 };
      },
      completeProjectAction: async (input: { openTasks: string }) => { calls.push(['complete', input.openTasks]); return { success: true, status: 'done' }; },
    };
  }, readOnly);
  await openApp(page, 'tests/browser/planner-work.fixture.tsx');
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);
const work = (page: Page) => page.getByTestId('project-work');

test('W6: All groups every project by stage (or Assigned to) with a totals row', async ({ page }) => {
  await open(page);
  const table = page.getByTestId('projects-all');
  await expect(table.getByRole('group', { name: 'In progress, 2' })).toContainText('Website relaunch');
  await expect(table.getByRole('group', { name: 'To do, 1' })).toContainText('Pricing');
  await expect(table.locator('tfoot')).toContainText(/3 projects\s*Average 50%/);
  await table.getByRole('combobox', { name: 'Group by' }).selectOption('assignee');
  await expect(table.getByRole('group', { name: 'Asha, 1' })).toContainText('Website relaunch');
  await expect(table.getByRole('group', { name: 'Unassigned, 1' })).toContainText('Pricing');
  await page.screenshot({ path: 'test-results/projects/all.png' });
  await table.getByRole('button', { name: /Website relaunch/ }).click();
  expect(await page.evaluate(() => (window as any).__opened)).toBe('p1');
});

test('W6: Active is Planning and In progress, edited in place; an ended project says so; Blocked by names', async ({ page }) => {
  await open(page);
  const active = page.getByTestId('projects-active');
  await expect(active.locator('tbody tr')).toHaveCount(2);
  await expect(active).not.toContainText('Pricing');
  await expect(active.getByRole('row', { name: /^WT-6 Design system/ })).toContainText('Ended 3 days ago');
  await expect(active.getByRole('row', { name: /^WT-4 Website relaunch/ })).toContainText('Design system');
  await active.getByLabel('Assigned to for Website relaunch').selectOption('u2');
  await active.getByLabel('Priority for Website relaunch').selectOption('urgent');
  await active.getByLabel('End of Website relaunch').fill('2026-12-24');
  await expect.poll(() => calls(page)).toEqual([['assign', 'p1', 'u2'], ['field', 'p1', 'priority', 'urgent'], ['dates', 'p1', '2026-12-24']]);
});

test('W11: a viewer sees plain text, no selects or date fields', async ({ page }) => {
  await open(page, 1280, true);
  const active = page.getByTestId('projects-active');
  await expect(active.getByRole('row', { name: /^WT-4 Website relaunch/ })).toContainText(/Asha.*Dec 2 → Dec 20.*high/);
  await expect(active.getByRole('combobox')).toHaveCount(0);
  await expect(active.locator('input[type=date]')).toHaveCount(0);
});

test('W3: the Work tab shows completion and work; Add existing and Remove with Undo; New task carries Part of', async ({ page }) => {
  await open(page);
  await expect(work(page)).toContainText('50%');
  await expect(work(page)).toContainText('WT-2');
  await work(page).getByLabel('Add an existing task').selectOption('c');
  await expect(work(page)).toContainText('Write the copy');
  await work(page).getByRole('button', { name: 'Remove Build from the project' }).click();
  await expect.poll(() => calls(page)).toEqual([['partOf', ['c'], 'p1'], ['partOf', ['b'], null]]);
  await work(page).getByRole('button', { name: 'New task' }).click();
  expect(await page.evaluate(() => (window as any).__newIn)).toBe('p1');
});

test('W5.3: Completed with open work asks Leave them or Move them to the Backlog', async ({ page }) => {
  await open(page);
  const pageSection = page.getByRole('region', { name: 'Project page' });
  await pageSection.getByRole('button', { name: /Stage: In progress/ }).click();
  await page.getByRole('menuitem', { name: 'Completed' }).click();
  const dialog = page.getByRole('dialog', { name: '1 task is still open' });
  await dialog.getByRole('button', { name: 'Move them to the Backlog' }).click();
  await expect.poll(() => calls(page)).toEqual([['complete', 'backlog']]);
  await expect(pageSection.getByRole('button', { name: /Stage: Completed/ })).toBeVisible();
});

test('phone: no accessibility violations', async ({ page }) => {
  await open(page, 375);
  await expect(work(page)).toContainText('Design');
  expect(await axeViolations(page)).toEqual([]);
});
