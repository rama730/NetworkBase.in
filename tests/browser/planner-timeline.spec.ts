import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.5 W2, W4 and S3, S6, S7 (plan A1.4): bars by stage group, Today, drawing with the quick-create bubble,
// moving a blocker asks to shift what depends on it, arrows refuse loops, and every drag has a keyboard or menu path.
async function open(page: Page, opts: { width?: number; readOnly?: boolean } = {}) {
  await page.clock.setFixedTime(new Date('2026-11-20T10:00:00'));
  await page.setViewportSize({ width: opts.width ?? 1280, height: 900 });
  await page.addInitScript((readOnly) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__readOnly = readOnly;
    try { localStorage.setItem('nb:timeline-zoom', 'month'); } catch { /* none */ }
    const projects = [
      { id: 'a', taskNumber: 1, title: 'Design system', stage: 'completed', status: 'done', startDate: '2026-11-16T00:00:00.000Z', dueDate: '2026-11-25T00:00:00.000Z', completion: { percent: 100 } },
      { id: 'b', taskNumber: 2, title: 'Website relaunch', stage: 'in_progress', status: 'in_progress', startDate: '2026-11-26T00:00:00.000Z', dueDate: '2026-12-10T00:00:00.000Z', completion: { percent: 40 } },
      { id: 'c', taskNumber: 3, title: 'Pricing', stage: 'not_started', status: 'todo', startDate: null, dueDate: null, completion: { percent: 0 } },
    ];
    const deps = [{ taskId: 'b', blockedById: 'a' }];
    (window as any).__actions = {
      readProjectsAction: async () => ({ success: true, projectKey: 'WT', projects: projects.map((p) => ({ ...p })), deps: deps.map((d) => ({ ...d })) }),
      setTaskDatesAction: async (input: { taskId: string; startDate?: string; dueDate?: string }) => {
        calls.push(['dates', input.taskId, input.startDate?.slice(0, 10) ?? null, input.dueDate?.slice(0, 10) ?? null]);
        const p = projects.find((x) => x.id === input.taskId)!;
        if (input.startDate) p.startDate = input.startDate;
        if (input.dueDate) p.dueDate = input.dueDate;
        const late = input.taskId === 'a' && p.dueDate! >= projects[1]!.startDate!;
        return { success: true, conflicts: late ? ['b'] : [], toShift: late ? [{ id: 'b', title: 'Website relaunch' }] : [], days: late ? 3 : 0 };
      },
      shiftDependentsAction: async (input: { taskId: string; days: number }) => { calls.push(['shift', input.taskId, input.days]); return { success: true, count: 1 }; },
      setBlockedByAction: async (input: { taskId: string; blockedById: string; remove?: boolean }) => {
        calls.push(['arrow', input.taskId, input.blockedById, Boolean(input.remove)]);
        return input.taskId === 'a' ? { success: false, error: 'That would make a loop: Website relaunch is blocked by Design system' } : { success: true };
      },
      createTaskAction: async (input: { title: string; startDate: string; dueDate: string; itemType: string; assigneeId: string }) => {
        calls.push(['create', input.title, input.itemType, input.startDate.slice(0, 10), input.dueDate.slice(0, 10), input.assigneeId]);
        return { success: true, task: { id: 'n' } };
      },
    };
  }, Boolean(opts.readOnly));
  await openApp(page, 'tests/browser/planner-timeline.fixture.tsx');
  await expect(page.getByTestId('timeline-bar').first()).toBeVisible();
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);
const bar = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name},`) });

test('S3: stage groups, bars with dates and completion, Today, sprints, No dates tray', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('planner-timeline')).toContainText(/To do\s*0/);
  await expect(bar(page, 'Website relaunch')).toHaveAccessibleName('Website relaunch, Nov 26 to Dec 10, In progress, 40% complete');
  await expect(page.getByTestId('timeline-no-dates')).toContainText('Pricing');
  await page.getByLabel('Show sprints').check();
  await expect(page.getByTestId('timeline-grid')).toContainText('Sprint 7');
  await page.screenshot({ path: 'test-results/planner-timeline/month.png' });
  await page.getByRole('button', { name: 'Week' }).click();
  await expect(page.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
});

test('W4: moving a blocker later asks to shift what depends on it; Move them shifts with Undo; keyboard nudges', async ({ page }) => {
  await open(page);
  await bar(page, 'Design system').focus();
  await page.keyboard.press(']');
  await expect.poll(() => calls(page)).toEqual([['dates', 'a', '2026-11-17', '2026-11-26']]);
  const dialog = page.getByRole('dialog', { name: 'Move 1 project that depends on this by 3 days?' });
  await expect(dialog).toContainText('Website relaunch');
  await dialog.getByRole('button', { name: 'Move them' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['shift', 'a', 3]);
  await expect(page.getByTestId('toast')).toContainText('Design system: Nov 17 → Nov 26 · moved 1 more by 3 days');
  await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['shift', 'a', -3]);
  await expect.poll(() => calls(page)).toContainEqual(['dates', 'a', '2026-11-16', '2026-11-25']);
});

test('W4: dragging the end dot onto another bar draws an arrow; a loop is refused; the row menu does the same', async ({ page }) => {
  await open(page);
  const dot = page.getByTestId('timeline-end-dot').first(); // Website relaunch (In progress comes first)
  const target = await bar(page, 'Design system').boundingBox();
  const from = await dot.boundingBox();
  await page.mouse.move(from!.x + 3, from!.y + 3);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => calls(page)).toEqual([['arrow', 'a', 'b', false]]);
  await expect(page.getByTestId('toast')).toContainText('That would make a loop: Website relaunch is blocked by Design system');
  await page.getByRole('button', { name: 'More for Website relaunch' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Design system' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['arrow', 'b', 'a', true]);
});

test('W2: drawing across the empty row opens the bubble; Enter creates a project assigned to me; More details', async ({ page }) => {
  await open(page);
  const lane = await page.getByTestId('timeline-draw-lane').boundingBox();
  const bar0 = await bar(page, 'Website relaunch').boundingBox(); // starts Nov 26
  const day = 18; // Month zoom: 18 px a day
  await page.mouse.move(bar0!.x + day / 2, lane!.y + lane!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar0!.x + day * 4 + day / 2, lane!.y + lane!.height / 2, { steps: 6 });
  await page.mouse.up();
  const bubble = page.getByRole('dialog', { name: 'New project' });
  await expect(bubble).toContainText('Nov 26 → Nov 30');
  // The bubble sits inside the grid's frame, never clipped by it.
  const frame = (await page.getByTestId('timeline-grid').boundingBox())!;
  const create = (await bubble.getByRole('button', { name: 'Create' }).boundingBox())!;
  expect(create.y + create.height).toBeLessThanOrEqual(frame.y + frame.height);
  await bubble.getByLabel('Project name').fill('Launch party');
  await page.keyboard.press('Enter');
  await expect.poll(() => calls(page)).toEqual([['create', 'Launch party', 'project', '2026-11-26', '2026-11-30', 'u1']]);
});

test('read only: no drawing lane, no handles; clicking a bar opens it; phone has no axe violations', async ({ page }) => {
  await open(page, { readOnly: true, width: 375 });
  await expect(page.getByTestId('timeline-draw-lane')).toHaveCount(0);
  await expect(page.getByTestId('timeline-end-dot')).toHaveCount(0);
  await bar(page, 'Website relaunch').click();
  expect(await page.evaluate(() => (window as any).__opened)).toBe('b');
  expect(await axeViolations(page)).toEqual([]);
});
