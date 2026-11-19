import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.2 F1 (plan A0.10): a bug's page says where it shows; the Stage menu moves it; joining the board asks for the
// running sprint (ticked, remembered 24 hours); members' bugs go to the Backlog.
async function open(page: Page, query = '') {
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      setTaskStageAction: async (input: { stage: string; sprintId?: string; toBacklog?: boolean }) => {
        calls.push([input.stage, input.sprintId ?? null, input.toBacklog ?? false]);
        const status = { new: 'todo', confirmed: 'todo', fixing: 'in_progress', fixed: 'done' }[input.stage] ?? 'todo';
        return { success: true, status, outcome: 'moved', updatedAt: new Date().toISOString() };
      },
    };
  });
  await openApp(page, 'tests/browser/task-stage.fixture.tsx', { path: `/?${query}` });
}
const control = (page: Page) => page.getByTestId('task-stage-control');
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('S7: off the board it shows in Bugs only; the Stage menu has Bugs and On the board brackets', async ({ page }) => {
  await open(page);
  await expect(control(page)).toContainText('Shows in: Bugs · Confirmed');
  await control(page).getByRole('button', { name: /Stage: Confirmed/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toContainText('Bugs');
  await expect(menu).toContainText('On the board');
  await page.screenshot({ path: 'test-results/task-stage/menu.png' });
  await page.getByRole('menuitem', { name: 'New' }).click();
  await expect(control(page)).toContainText('Shows in: Bugs · New');
  expect(await calls(page)).toEqual([['new', null, true]]);
});

test('W4 + S4: moving to Fixing opens the Join-board sheet with the running sprint ticked; Move puts it in Week 47', async ({ page }) => {
  await open(page);
  await control(page).getByRole('button', { name: /Stage/ }).click();
  await page.getByRole('menuitem', { name: 'Fixing' }).click();
  const sheet = page.getByRole('dialog', { name: 'Bug joins Tasks at Fixing' });
  await expect(sheet.getByRole('checkbox', { name: 'Add to Week 47' })).toBeChecked();
  await page.screenshot({ path: 'test-results/task-stage/sheet.png' });
  await sheet.getByRole('button', { name: 'Move' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(control(page)).toContainText('Shows in: Tasks · In progress / Bugs · Fixing');
  expect(await calls(page)).toEqual([['fixing', '9b2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e50', false]]);
});

test('W4.5 + call 6: unticking sends it to the Backlog, and the choice is remembered next time', async ({ page }) => {
  await open(page);
  await control(page).getByRole('button', { name: /Stage/ }).click();
  await page.getByRole('menuitem', { name: 'Fixing' }).click();
  await page.getByRole('checkbox', { name: 'Add to Week 47' }).uncheck();
  await page.getByRole('button', { name: 'Move' }).click();
  await control(page).getByRole('button', { name: /Stage/ }).click();
  await page.getByRole('menuitem', { name: 'Confirmed' }).click();
  await control(page).getByRole('button', { name: /Stage/ }).click();
  await page.getByRole('menuitem', { name: 'Fixing' }).click();
  await expect(page.getByRole('checkbox', { name: 'Add to Week 47' })).not.toBeChecked();
  expect((await calls(page))[0]).toEqual(['fixing', null, true]);
});

test('members (and no running sprint): the sheet says Goes to the Backlog, with no tick', async ({ page }) => {
  await open(page, 'plan=0');
  await control(page).getByRole('button', { name: /Stage/ }).click();
  await page.getByRole('menuitem', { name: 'Fixing' }).click();
  await expect(page.getByRole('dialog')).toContainText('Goes to the Backlog · owners and admins plan sprints');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await axeViolations(page)).toEqual([]);
});
