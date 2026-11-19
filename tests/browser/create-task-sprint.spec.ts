import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.4 calls 3–4, W4 (plan A0.7): Sprint is offered to owners and admins (decision 146); members are told their
// new item goes to the Backlog instead of seeing a picker that would be refused.
const open = (page: Page, plan: boolean) => openApp(page, 'tests/browser/create-task-sprint.fixture.tsx', { path: `/?plan=${plan ? 1 : 0}` });

test('an owner or admin picks a running sprint and the task is created in it', async ({ page }) => {
  await open(page, true);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Sprint').selectOption('5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f');
  await dialog.locator('input[name=title]').fill('Plan the release');
  await dialog.getByRole('button', { name: /Create task/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__created?.sprintId)).toBe('5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f');
  await expect(page.getByTestId('sprint-backlog-note')).toHaveCount(0);
});

test('W4: a member sees "Goes to the Backlog" with no picker, and the task has no sprint', async ({ page }) => {
  await open(page, false);
  const dialog = page.getByRole('dialog');
  await expect(page.getByTestId('sprint-backlog-note')).toHaveText('Goes to the Backlog · owners and admins plan sprints');
  await expect(dialog.locator('select[name=sprintId]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/create-task-sprint/member.png' });
  expect(await axeViolations(page)).toEqual([]);
  await dialog.locator('input[name=title]').fill('Fix the footer');
  await dialog.getByRole('button', { name: /Create task/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__created?.title)).toBe('Fix the footer');
  expect(await page.evaluate(() => (window as any).__created?.sprintId ?? null)).toBeNull();
});
