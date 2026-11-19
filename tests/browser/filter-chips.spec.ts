import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.4 F3 (plan A0.11): Assigned to · Type · Due · + Filter; set chips read "Name: value ✕"; Clear all from two;
// the address keeps them so a link reopens the same view; phones get one Filters sheet.
const open = (page: Page, path = '/') => openApp(page, 'tests/browser/filter-chips.fixture.tsx', { path });
const titles = (page: Page) => page.getByRole('list', { name: 'Tasks' }).getByRole('listitem');

test('W7: Assigned to → Me narrows the list, reads "Assigned to: Me" and ✕ clears it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await page.getByRole('button', { name: 'Assigned to', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Me' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Asha' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Assigned to: Me +1' })).toBeVisible();
  await expect(titles(page)).toHaveText(['Fix login', 'Write docs']);
  expect(page.url()).toContain('assignee=me%2C');
  await page.getByRole('button', { name: 'Remove the Assigned to filter' }).click();
  await expect(titles(page)).toHaveCount(3);
});

test('Type shows counts; + Filter adds Priority; Clear all appears with two set and clears both', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await page.getByRole('button', { name: 'Type', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: /Bug\s*1/ })).toBeVisible();
  await page.getByRole('menuitemcheckbox', { name: /Task/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Clear all' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Priority' }).click();
  await page.getByRole('button', { name: 'Priority', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Low' }).click();
  await page.keyboard.press('Escape');
  await expect(titles(page)).toHaveText(['Pick a venue']);
  await page.screenshot({ path: 'test-results/filter-chips/desktop.png' });
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(titles(page)).toHaveCount(3);
});

test('a copied link reopens the same view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, '/?due=today&type=bug');
  await expect(page.getByRole('button', { name: 'Due: Today' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Type: Bug' })).toBeVisible();
  await expect(titles(page)).toHaveText(['Fix login']);
});

test('W9 phone: one Filters button opens a sheet with every chip; no accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  await page.getByTestId('filters-button').click();
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await sheet.getByRole('region', { name: 'Due' }).getByRole('radio', { name: 'No date' }).click();
  await expect(sheet.getByRole('radio', { name: 'No date' })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: 'test-results/filter-chips/phone.png' });
  expect(await axeViolations(page)).toEqual([]);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(titles(page)).toHaveText(['Write docs', 'Pick a venue']);
  await expect(page.getByTestId('filters-button')).toContainText('1');
});
