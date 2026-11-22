import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.5 W7 and W3.4 (plan A1.6): one swimlane per open project plus No project; dropping in another lane sets
// Part of (with Undo), in another column moves the status; every move has a menu; No project groups into a project.
async function open(page: Page, opts: { width?: number; readOnly?: boolean } = {}) {
  await page.setViewportSize({ width: opts.width ?? 1280, height: 900 });
  await page.addInitScript((readOnly) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__readOnly = readOnly;
    (window as any).__actions = {
      readProjectsAction: async () => ({ success: true, projectKey: 'WT', deps: [], projects: [
        { id: 'p1', taskNumber: 9, title: 'Website relaunch', stage: 'in_progress', status: 'in_progress', priority: 'medium', assigneeId: null, startDate: null, dueDate: null, completion: { percent: 0, source: 'work' } },
        { id: 'p2', taskNumber: 10, title: 'Pricing', stage: 'not_started', status: 'todo', priority: 'medium', assigneeId: null, startDate: null, dueDate: null, completion: { percent: 0, source: 'none' } },
        { id: 'p3', taskNumber: 11, title: 'Old launch', stage: 'completed', status: 'done', priority: 'medium', assigneeId: null, startDate: null, dueDate: null, completion: { percent: 100, source: 'work' } },
      ] }),
      setPartOfAction: async (input: { taskIds: string[]; partOfId: string | null }) => { calls.push(['partOf', input.taskIds, input.partOfId]); return { success: true, count: 1 }; },
      // Like the server: Part of changes the card, so a column move after it fails the "unchanged since read" check.
      moveTaskToWorkflowColumnAction: async (id: string, _p: string, column: string) => {
        if (calls.some((c: any) => c[0] === 'partOf' && c[1].includes(id))) return { success: false, error: 'This task changed. Refresh and try again.' };
        calls.push(['column', id, column]); return { success: true };
      },
      groupIntoProjectAction: async (input: { taskIds: string[]; name: string }) => { calls.push(['group', input.taskIds, input.name]); return { success: true, id: 'p9' }; },
    };
  }, Boolean(opts.readOnly));
  await openApp(page, 'tests/browser/planner-lanes.fixture.tsx');
  await expect(page.getByTestId('board-lane')).toHaveCount(3);
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);
const lane = (page: Page, name: RegExp) => page.getByRole('group', { name });

test('W7.1: a lane per open project plus No project, cards in their columns', async ({ page }) => {
  await open(page);
  await expect(lane(page, /^Website relaunch, 2$/)).toContainText('Write the copy');
  await expect(lane(page, /^Pricing, 0$/)).toBeVisible();
  await expect(lane(page, /^No project, 2$/)).toContainText('Fix the footer');
  await expect(page.getByRole('group', { name: /Old launch/ })).toHaveCount(0);
  await expect(page.getByLabel('Website relaunch, In progress')).toContainText('Design the hero');
  await page.screenshot({ path: 'test-results/planner-lanes/lanes.png' });
});

test('W7.2: dropping in another lane sets Part of; in another column moves the status', async ({ page }) => {
  await open(page);
  await page.getByText('Fix the footer').dragTo(page.getByLabel('Pricing, In progress'));
  await expect.poll(() => calls(page)).toEqual([['column', 't3', 'c2'], ['partOf', ['t3'], 'p2']]);
  await expect(page.getByTestId('toast')).toContainText('Part of Pricing');
});

test('W7: the menus move a card without dragging', async ({ page }) => {
  await open(page);
  await page.getByLabel('Move Write the copy to project…').selectOption({ label: 'No project' });
  await page.getByLabel('Move Design the hero to column…').selectOption({ label: 'Completed' });
  await expect.poll(() => calls(page)).toEqual([['partOf', ['t1'], null], ['column', 't2', 'c3']]);
});

test('W3.4: No project → Group into a project names one and picks its tasks', async ({ page }) => {
  await open(page);
  await lane(page, /^No project/).getByRole('button', { name: 'Group into a project' }).click();
  const dialog = page.getByRole('dialog', { name: 'Group into a project' });
  await dialog.getByLabel('Project name').fill('Footer refresh');
  await dialog.getByLabel('Fix the footer').check();
  await dialog.getByLabel('Update pricing').check();
  await dialog.getByRole('button', { name: 'Group 2' }).click();
  await expect.poll(() => calls(page)).toEqual([['group', ['t3', 't4'], 'Footer refresh']]);
});

test('read only: no menus or Group; phone has no axe violations', async ({ page }) => {
  await open(page, { readOnly: true, width: 375 });
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Group into a project' })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});
