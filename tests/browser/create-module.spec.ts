import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.4 F3 (plan A0.8): one module makes every type; Starts at decides the board, the footer says where it shows.
const open = (page: Page, query = '') => openApp(page, 'tests/browser/create-module.fixture.tsx', { path: `/?${query}` });
const dialog = (page: Page) => page.getByRole('dialog');
const footer = (page: Page) => page.getByTestId('create-footer-line');
const created = (page: Page) => page.evaluate(() => (window as any).__created);

test('W1: New → Bug from Tasks starts at Fixing on the board, with Sprint, the footer line and Create bug', async ({ page }) => {
  await open(page, 'type=bug');
  await expect(dialog(page).getByRole('heading', { name: 'Create bug' })).toBeVisible();
  await expect(dialog(page).getByRole('tab', { name: 'Bug' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog(page).getByRole('tab')).toHaveText(['Task', 'Bug', 'Request']);
  await expect(dialog(page).getByLabel('Starts at')).toHaveValue('fixing');
  await expect(dialog(page).getByLabel('Sprint')).toBeVisible();
  await expect(footer(page)).toHaveText('Joins Tasks at Fixing · also shows in Bugs');
  await dialog(page).getByLabel('Bug title').fill('Login button does nothing');
  await page.screenshot({ path: 'test-results/create-module/bug-light.png' });
  await dialog(page).getByLabel('Bug title').press('Control+Enter');
  await expect.poll(() => created(page)).toEqual([expect.objectContaining({ title: 'Login button does nothing', itemType: 'bug', stage: 'fixing' })]);
});

test('W2: from the own tab a bug starts at New: off the board, no Sprint; Fixing brings both back', async ({ page }) => {
  await open(page, 'type=bug&from=own');
  await expect(dialog(page).getByLabel('Starts at')).toHaveValue('new');
  await expect(footer(page)).toHaveText('Shows in Bugs · not on the Tasks board yet');
  await expect(dialog(page).getByLabel('Sprint')).toHaveCount(0);
  await dialog(page).getByLabel('Starts at').selectOption('fixing');
  await expect(footer(page)).toHaveText('Joins Tasks at Fixing · also shows in Bugs');
  await expect(dialog(page).getByLabel('Sprint')).toBeVisible();
  await expect(dialog(page).getByLabel('Starts at').locator('option')).toHaveText(['New', 'Confirmed', 'Fixing · on the board']);
});

test('W3: switching type keeps title, description and due; Request renames Due to Need by; Task has no footer line', async ({ page }) => {
  await open(page);
  await expect(dialog(page).getByRole('heading', { name: 'Create task' })).toBeVisible();
  await expect(footer(page)).toHaveCount(0);
  await dialog(page).locator('#task-title').fill('Venue contract');
  await dialog(page).getByLabel('Description').fill('Send it to legal');
  await dialog(page).getByRole('button', { name: '1 week' }).click();
  const due = await dialog(page).getByLabel('Due date').inputValue();
  await dialog(page).getByRole('tab', { name: 'Request' }).click();
  await expect(dialog(page).locator('#task-title')).toHaveValue('Venue contract');
  await expect(dialog(page).getByLabel('Description')).toHaveValue('Send it to legal');
  await expect(dialog(page).getByLabel('Need by')).toHaveValue(due);
  await expect(dialog(page).getByLabel('Starts at')).toHaveValue('accepted');
  await dialog(page).getByRole('tab', { name: 'Task' }).click();
  await expect(dialog(page).getByLabel('Due date')).toHaveValue(due);
  await expect(dialog(page).getByLabel('Status')).toBeVisible();
});

test('a member is told the Backlog in the footer line', async ({ page }) => {
  await open(page, 'type=bug&plan=0');
  await expect(footer(page)).toHaveText('Joins Tasks at Fixing · also shows in Bugs · Goes to the Backlog');
});

test('W8: a type removed while the module was open offers Create as task, which makes a plain task', async ({ page }) => {
  await open(page, 'type=bug&removed=1');
  await dialog(page).getByLabel('Bug title').fill('Crash on save');
  await dialog(page).getByRole('button', { name: 'Create bug' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Bugs was removed from this workspace');
  await dialog(page).getByRole('button', { name: 'Create as task' }).click();
  await expect.poll(async () => (await created(page)).length).toBe(2);
  const [, second] = await created(page);
  expect(second.itemType).toBeUndefined();
  expect(second.title).toBe('Crash on save');
});

test('W9 phone and dark: tabs and footer fit; no accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openApp(page, 'tests/browser/create-module.fixture.tsx', { path: '/?type=bug', head: "document.documentElement.classList.add('dark')" });
  await expect(footer(page)).toBeVisible();
  await page.screenshot({ path: 'test-results/create-module/bug-phone-dark.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(await axeViolations(page)).toEqual([]);
});
