import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 11.7 and 38.5 W9 (plan A1.2): placement, moves by menu (priority, or a date on the way into or out of Urgent)
// with Undo, Delegate's Assign…, Drop's Move to Backlog, and the phone's folding sections.
async function open(page: Page, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await page.clock.setFixedTime(new Date('2026-11-20T10:00:00'));
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      updateTaskFieldAction: async (id: string, field: string, value: unknown) => { calls.push([id, field, value]); return { success: true }; },
      assignTaskAction: async (id: string, assignee: string | null) => { calls.push([id, 'assign', assignee]); return { success: true }; },
    };
  });
  await openApp(page, 'tests/browser/tasks-matrix.fixture.tsx');
}
const box = (page: Page, name: string) => page.getByRole('region', { name: new RegExp(`^${name},`) });
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('placement: the four boxes with counts, axis rules, the No date mark; done items sit nowhere', async ({ page }) => {
  await open(page);
  await expect(box(page, 'Do first')).toContainText('Fix sign-in bug');
  await expect(box(page, 'Schedule')).toContainText('Pricing page');
  await expect(box(page, 'Schedule')).toContainText('No date');
  await expect(box(page, 'Delegate')).toContainText(/Book venue.*Overdue/);
  await expect(box(page, 'Drop')).toContainText('Old logo ideas');
  await expect(page.getByTestId('tasks-matrix')).not.toContainText('Shipped thing');
  await expect(page.getByText('due in 3 days or overdue')).toBeVisible();
  await page.screenshot({ path: 'test-results/tasks-matrix/grid.png' });
});

test('moving up a row sets High with Undo; into Urgent asks for a date; out of Urgent clears it', async ({ page }) => {
  await open(page);
  await box(page, 'Drop').getByRole('button', { name: 'Move Old logo ideas' }).click();
  await page.getByRole('menuitem', { name: 'Schedule' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await box(page, 'Schedule').getByRole('button', { name: 'Move Pricing page' }).click();
  await page.getByRole('menuitem', { name: 'Do first' }).click();
  await page.getByRole('dialog', { name: 'When is it due?' }).getByRole('button', { name: 'Tomorrow' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await box(page, 'Do first').getByRole('button', { name: 'Move Fix sign-in bug' }).click();
  await page.getByRole('menuitem', { name: 'Schedule' }).click();
  await page.getByRole('dialog', { name: 'Not urgent any more' }).getByRole('button', { name: 'Clear the date' }).click();
  await expect.poll(() => calls(page)).toEqual([
    ['e', 'priority', 'high'], ['e', 'priority', 'medium'],
    ['b', 'dueDate', '2026-11-21T00:00:00.000Z'],
    ['a', 'dueDate', null],
  ]);
});

test("Delegate's Assign… assigns the selected cards; Drop's Move to Backlog clears their sprint", async ({ page }) => {
  await open(page);
  await box(page, 'Delegate').getByRole('checkbox', { name: 'Select Book venue' }).check();
  await box(page, 'Delegate').getByRole('button', { name: 'Assign…' }).click();
  await page.getByLabel('Assigned to').selectOption({ label: 'Asha' });
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await box(page, 'Drop').getByRole('checkbox', { name: 'Select Old logo ideas' }).check();
  await box(page, 'Drop').getByRole('button', { name: 'Move to Backlog' }).click();
  await expect.poll(() => calls(page)).toEqual([['c', 'assign', '7a0c1c34-1c7b-4b56-9d55-5f1f1d7c2a10'], ['e', 'sprintId', null]]);
});

test('phone: four folding sections, Do first open; no accessibility violations', async ({ page }) => {
  await open(page, 375);
  const sections = page.locator('details');
  await expect(sections).toHaveCount(4);
  await expect(sections.first()).toHaveAttribute('open', '');
  await expect(sections.nth(1)).not.toHaveAttribute('open', '');
  await page.screenshot({ path: 'test-results/tasks-matrix/phone.png', fullPage: true });
  expect(await axeViolations(page)).toEqual([]);
});
