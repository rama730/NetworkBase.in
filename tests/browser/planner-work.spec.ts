import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.5 T1 (plan A1.3): projects grouped by stage with completion; the Work tab adds and removes work with Undo
// and opens New with Part of; completing with open work asks Leave them or Move them to the Backlog.
async function open(page: Page, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const work = [
      { id: 'a', taskNumber: 1, title: 'Design', status: 'done', stage: null, itemType: 'task', dueDate: null, assigneeId: null, sprintId: null },
      { id: 'b', taskNumber: 2, title: 'Build', status: 'todo', stage: null, itemType: 'task', dueDate: '2026-12-10T00:00:00.000Z', assigneeId: null, sprintId: null },
    ];
    (window as any).__actions = {
      readProjectsAction: async () => ({ success: true, projectKey: 'WT', projects: [
        { id: 'p1', taskNumber: 4, title: 'Website relaunch', stage: 'in_progress', status: 'in_progress', assigneeId: null, startDate: '2026-12-02T00:00:00.000Z', dueDate: '2026-12-20T00:00:00.000Z', completion: { percent: 50, source: 'work' } },
        { id: 'p2', taskNumber: 5, title: 'Pricing', stage: 'not_started', status: 'todo', assigneeId: null, startDate: null, dueDate: null, completion: { percent: 0, source: 'none' } },
      ] }),
      readProjectWorkAction: async () => ({ success: true, projectKey: 'WT', work: work.map((x) => ({ ...x })), completion: { percent: Math.round(100 * work.filter((x) => x.status === 'done').length / Math.max(1, work.length)), source: 'work' } }),
      setPartOfAction: async (input: { taskIds: string[]; partOfId: string | null }) => {
        calls.push(['partOf', input.taskIds, input.partOfId]);
        if (input.partOfId) work.push({ id: 'c', taskNumber: 9, title: 'Write the copy', status: 'todo', stage: null, itemType: 'task', dueDate: null, assigneeId: null, sprintId: null });
        else work.splice(work.findIndex((x) => input.taskIds.includes(x.id)), 1);
        return { success: true, count: 1 };
      },
      completeProjectAction: async (input: { openTasks: string }) => { calls.push(['complete', input.openTasks]); return { success: true, status: 'done' }; },
    };
  });
  await openApp(page, 'tests/browser/planner-work.fixture.tsx');
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);
const work = (page: Page) => page.getByTestId('project-work');

test('W1: projects grouped To do · In progress · Complete with dates and completion', async ({ page }) => {
  await open(page);
  const list = page.getByTestId('projects-list');
  await expect(list.getByRole('group', { name: 'In progress, 1' })).toContainText(/WT-4\s*Website relaunch\s*In progress/);
  await expect(list.getByRole('group', { name: 'In progress, 1' })).toContainText('50%');
  await expect(list.getByRole('group', { name: 'To do, 1' })).toContainText('Pricing');
  await expect(list.getByRole('group', { name: 'Complete, 0' })).toContainText('Nothing here.');
  await page.screenshot({ path: 'test-results/projects/list.png' });
  await list.getByRole('button', { name: /Website relaunch/ }).click();
  expect(await page.evaluate(() => (window as any).__opened)).toBe('p1');
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
  await page.getByRole('button', { name: /Stage: In progress/ }).click();
  await page.getByRole('menuitem', { name: 'Completed' }).click();
  const dialog = page.getByRole('dialog', { name: '1 task is still open' });
  await dialog.getByRole('button', { name: 'Move them to the Backlog' }).click();
  await expect.poll(() => calls(page)).toEqual([['complete', 'backlog']]);
  await expect(page.getByRole('button', { name: /Stage: Completed/ })).toBeVisible();
});

test('phone: no accessibility violations', async ({ page }) => {
  await open(page, 375);
  await expect(work(page)).toContainText('Design');
  expect(await axeViolations(page)).toEqual([]);
});
