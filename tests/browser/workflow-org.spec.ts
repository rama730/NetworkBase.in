import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.2 W8 (organization pushes to every workspace) and W9 (wizard suggestions), plan A0.3.
async function open(page: Page, path: string, theme = 'light') {
  await page.addInitScript(() => {
    const pushed = new Set<string>();
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readOrgWorkflowsAction: async () => ({ success: true, enabled: true, canManage: true, workspaces: 3, rows: [...pushed].map((workflow) => ({ workflow, pushed: true })) }),
      pushWorkflowAction: async (i: { workflow: string }) => { calls.push(['push', i.workflow]); pushed.add(i.workflow); return { success: true, name: 'Bugs', workspaces: 3 }; },
      orgPushCountsAction: async () => ({ success: true, total: 9, open: 4, onBoard: 2 }),
      unpushWorkflowAction: async (i: { workflow: string }) => { calls.push(['unpush', i.workflow]); pushed.delete(i.workflow); return { success: true, name: 'Bugs', total: 9, open: 4, onBoard: 2 }; },
      orgPushedWorkflowsAction: async () => ({ success: true, by: 'Northgate CS', workflows: ['roadmap'] }),
    };
  });
  await openApp(page, 'tests/browser/workflow-org.fixture.tsx', { path, head: theme === 'dark' ? "document.documentElement.classList.add('dark')" : '' });
}

test('W8: an org admin adds Bugs to every workspace after confirming, then removes it with totals', async ({ page }) => {
  await open(page, '/?view=org');
  await expect(page.getByRole('heading', { name: 'Workflows for workspaces' })).toBeVisible();
  await page.getByRole('button', { name: 'Add to every workspace Bugs' }).click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(confirm).toContainText('Adds Bugs to 3 workspaces in Northgate CS. They can’t remove it.');
  await confirm.getByRole('button', { name: 'Add to 3 workspaces' }).click();
  // While it closes it still names the workflow (it said "Add undefined…" during the fade).
  for (let i = 0; i < 5; i++) { expect(await page.locator('body').innerText()).not.toContain('undefined'); await page.waitForTimeout(40); }
  await expect(page.getByText('Pushed to 3 workspaces')).toBeVisible();
  await page.screenshot({ path: 'test-results/workflow-org/org-card-light.png' });
  await page.getByRole('button', { name: 'Remove from workspaces Bugs' }).click();
  await expect(confirm).toContainText('9 bugs · 4 open · 2 on the board across 3 workspaces.');
  await confirm.getByRole('button', { name: 'Remove Bugs' }).click();
  await expect(page.getByText('Pushed to 3 workspaces')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([['push', 'bugs'], ['unpush', 'bugs']]);
});

test('W9: the wizard ticks only the first built suggestion; the org push is a locked row', async ({ page }) => {
  await open(page, '/?view=wizard&category=web_app&org=o1');
  const block = page.getByTestId('wizard-workflows');
  await expect(block).toBeVisible();
  await expect(block.getByRole('checkbox', { name: /Roadmap/ })).toBeChecked();
  await expect(block.getByRole('checkbox', { name: /Roadmap/ })).toBeDisabled();
  await expect(block).toContainText('Set by Northgate CS');
  await expect(block.getByRole('checkbox', { name: /Bugs/ })).toBeChecked();
  await expect(page.getByTestId('picked')).toHaveText('bugs');
  await block.getByRole('checkbox', { name: /Bugs/ }).uncheck();
  await expect(page.getByTestId('picked')).toHaveText('');
  await page.screenshot({ path: 'test-results/workflow-org/wizard-light.png' });
});

test('W9: a category with nothing built shows no block; dark mode has no accessibility violations', async ({ page }) => {
  await open(page, '/?view=wizard&category=learning', 'dark');
  await expect(page.getByTestId('wizard-workflows')).toHaveCount(0);
  await open(page, '/?view=org', 'dark');
  await expect(page.getByRole('heading', { name: 'Workflows for workspaces' })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});
