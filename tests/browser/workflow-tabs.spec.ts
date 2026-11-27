import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.2 F1 (plan A0.2): W1 add Bugs → tab after a divider, W2 Undo, W7 Remove hides with counts, members see no
// button, W10 phone, keyboard and screen reader names; light and dark, 1440 and 375 px.
async function open(page: Page, { role = 'owner', width = 1440, theme = 'light' }: { role?: string; width?: number; theme?: string } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ role }) => {
    const added: Array<Record<string, unknown>> = [];
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readWorkflowsAction: async () => ({ success: true, enabled: true, canManage: role === 'owner', added: [...added] }),
      addWorkflowAction: async (input: { workflow: string }) => {
        calls.push(['add', input.workflow]);
        added.push({ workflow: input.workflow, locked: false, by: null, addedAt: '2026-11-19T10:00:00Z', addedBy: 'Ada Lovelace' });
        return { success: true, name: input.workflow === 'bugs' ? 'Bugs' : 'Project planner', alreadyAdded: false, undoSeconds: 10 };
      },
      undoAddWorkflowAction: async (input: { workflow: string }) => {
        calls.push(['undo', input.workflow]);
        added.splice(added.findIndex((w) => w.workflow === input.workflow), 1);
        return { success: true, name: 'Bugs' };
      },
      workflowRemovalCountsAction: async () => ({ success: true, total: 24, open: 6, onBoard: (window as any).__onBoard ?? 3 }),
      removeWorkflowAction: async (input: { workflow: string }) => {
        calls.push(['remove', input.workflow]);
        added.splice(added.findIndex((w) => w.workflow === input.workflow), 1);
        return { success: true, name: 'Bugs', total: 24, open: 6, onBoard: 3 };
      },
    };
  }, { role });
  await openApp(page, 'tests/browser/workflow-tabs.fixture.tsx', { path: '/', head: theme === 'dark' ? "document.documentElement.classList.add('dark')" : '' });
}

test('W1 + W2: an owner adds Bugs, the tab appears after a divider, Undo takes it back', async ({ page }) => {
  await open(page);
  const button = page.getByTestId('add-workflow-button');
  await expect(page.getByTestId('workflow-tab-divider')).toHaveCount(0);
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Add workflow' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('searchbox', { name: 'Search workflows' })).toBeFocused();
  const groups = await dialog.locator('section[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(groups).toEqual(['Blends into Tasks', 'Own tab · same tasks', 'Blends into Documents', 'Blends into Files', 'Blends into Updates', 'Blends into Sprints', 'Later · parked']); // A7.7: every Part A workflow is built
  await expect(dialog.getByTestId('workflow-row-bugs')).toContainText('Adds a Bugs tab. Bugs join Tasks at Fixing.');
  await expect(dialog.getByTestId('workflow-row-parked').first()).toContainText('Coming later');
  await page.screenshot({ path: 'test-results/workflow-tabs/dialog-light-1440.png' });
  await dialog.getByRole('button', { name: 'Add Bugs' }).click();
  await expect(dialog.getByTestId('workflow-row-bugs')).toContainText('Added');
  await expect(dialog.getByRole('button', { name: 'Remove Bugs' })).toBeVisible();
  await expect(page.getByTestId('workflow-tab-divider')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Bugs' })).toBeVisible();
  await page.screenshot({ path: 'test-results/workflow-tabs/tabs-light-1440.png' });
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('tab', { name: 'Bugs' })).toHaveCount(0);
  await expect(page.getByTestId('toast').getByText('Bugs removed')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([['add', 'bugs'], ['undo', 'bugs']]);
});

test('Search filters rows and says when nothing matches', async ({ page }) => {
  await open(page);
  await page.getByTestId('add-workflow-button').click();
  const dialog = page.getByRole('dialog', { name: 'Add workflow' });
  await dialog.getByRole('searchbox').fill('timeline');
  await expect(dialog.getByTestId('workflow-row-project_planner')).toBeVisible();
  await expect(dialog.getByTestId('workflow-row-bugs')).toHaveCount(0);
  await dialog.getByRole('searchbox').fill('zzz');
  await expect(dialog.getByText('No workflow matches ‘zzz’')).toBeVisible();
});

test('W7: Remove shows what Bugs holds, then hides the tab', async ({ page }) => {
  await open(page);
  await page.getByTestId('add-workflow-button').click();
  const dialog = page.getByRole('dialog', { name: 'Add workflow' });
  await dialog.getByRole('button', { name: 'Add Bugs' }).click();
  await dialog.getByRole('button', { name: 'Remove Bugs' }).click();
  const remove = page.getByRole('dialog', { name: 'Remove Bugs?' });
  await expect(remove).toContainText('24 bugs · 6 open · 3 on the board');
  await expect(remove).toContainText('The 3 on the board stay there as plain tasks until they’re completed. Nothing is deleted; add Bugs again to bring everything back.');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/workflow-tabs/remove-light-1440.png' });
  await remove.getByRole('button', { name: 'Hide Bugs' }).click();
  for (let i = 0; i < 5; i++) { await expect(page.getByText('Remove ?')).toHaveCount(0); await page.waitForTimeout(40); }
  await expect(remove).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Bugs' })).toHaveCount(0);
});

test('W3: a member sees added tabs but no Add workflow button', async ({ page }) => {
  await open(page, { role: 'member' });
  await expect(page.getByRole('tab', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByTestId('add-workflow-button')).toHaveCount(0);
});

test('Keyboard: the arrow keys move from the default tabs onto workflow tabs; the button is the last stop', async ({ page }) => {
  await open(page);
  await page.getByTestId('add-workflow-button').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add Bugs' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Tasks' }).click();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Bugs' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tab-body')).toHaveText('bugs');
});

test('W10 phone and dark: the button is as tall as the tabs (44 px on touch, like them), its label is for screen readers; no accessibility violations', async ({ page }) => {
  await open(page, { width: 375, theme: 'dark' });
  const button = page.getByTestId('add-workflow-button');
  await button.scrollIntoViewIfNeeded();
  const [box, tab] = await Promise.all([button.boundingBox(), page.getByRole('tab', { name: 'Tasks' }).boundingBox()]);
  expect(box!.height).toBe(tab!.height);
  expect(await button.evaluate((el) => el.classList.contains('nb-touch-target') && el.classList.contains('nb-tab'))).toBe(true);
  await expect(button).toHaveAccessibleName('Add workflow');
  await page.screenshot({ path: 'test-results/workflow-tabs/tabs-dark-375.png' });
  await button.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/workflow-tabs/dialog-dark-375.png' });
  expect(await axeViolations(page)).toEqual([]);
});

test('W7 copy: one item on the board reads in the singular', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__onBoard = 1; });
  await open(page);
  await page.getByTestId('add-workflow-button').click();
  const dialog = page.getByRole('dialog', { name: 'Add workflow' });
  await dialog.getByRole('button', { name: 'Add Bugs' }).click();
  await dialog.getByRole('button', { name: 'Remove Bugs' }).click();
  await expect(page.getByRole('dialog', { name: 'Remove Bugs?' })).toContainText('The 1 on the board stays there as a plain task until it’s completed.');
});
