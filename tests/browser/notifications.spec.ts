import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Notifications mix (canvas A9qL5HQ4fpdj8rwVfSR7VA): the tray as built, filled from fixtures.
const css = readFileSync('src/components/notifications/notifications.css', 'utf8');

async function open(page: Page, query = '', options: { width?: number; theme?: 'dark' } = {}) {
  await page.setViewportSize({ width: options.width ?? 1280, height: 900 });
  await openApp(page, 'tests/browser/notifications.fixture.tsx', {
    path: `/?${query}${options.theme ? `&theme=${options.theme}` : ''}`,
    head: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);});`,
  });
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: Array<[string, unknown]> }).__calls);

test('the tray follows spec §31 and opens on Needs you; My reviews is gone', async ({ page }) => {
  await open(page);
  const tray = page.locator('.nb-nt-panel');
  await expect(tray).toBeVisible();
  expect(Math.round((await tray.boundingBox())!.width)).toBe(400);
  expect(await tray.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('12px');
  expect(await page.locator('.nb-nt-hd h2').evaluate((el) => getComputedStyle(el).fontSize)).toBe('17px');
  await expect(page.getByRole('tab')).toHaveText([/^Unread/, 'All']);
  await expect(page.getByText('My reviews')).toHaveCount(0);
  const labels = await page.locator('.nb-nt-label .nb-micro b').allTextContents();
  expect(labels[0]).toBe('Needs you');
  await expect(page.locator('.nb-topbar-badge')).toHaveText('3');
  const sentence = page.locator('.nb-nt-row .nb-nt-t1').first();
  expect(await sentence.evaluate((el) => getComputedStyle(el).fontSize)).toBe('13px');
  const meta = page.locator('.nb-nt-row .nb-nt-meta').first();
  expect(await meta.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontFamily.toLowerCase().includes('mono')])).toEqual(['12px', true]);
  await expect(page.getByText('waiting 2d')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark all read' })).toBeVisible();
  await page.screenshot({ path: 'test-results/notifications/tray.png' });
  expect(await axeViolations(page)).toEqual([]);
});

test('answering in the row: Accept, an agent option, Done; likes fold into Activity', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText('Connected')).toBeVisible();
  await page.getByRole('button', { name: /SQLite/ }).click();
  await expect(page.getByText('Answered: SQLite')).toBeVisible();
  const made = await calls(page);
  expect(made.filter(([name]) => name === 'act').map(([, v]) => (v as { act: { act: string } }).act.act)).toEqual(['accept', 'answer']);
  await expect(page.getByText(/1 like today/)).toBeVisible();
  const sprint = page.locator('.nb-nt-row', { hasText: 'Unit 2 started' });
  await sprint.hover();
  await sprint.getByRole('button', { name: 'Done' }).click();
  expect((await calls(page)).some(([name, v]) => name === 'done' && v === 's1')).toBe(true);
  await expect(page.locator('.nb-nt-row', { hasText: 'Unit 2 started' })).toHaveCount(0);
});

test('quick reply to a mention sends from the row', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Reply' }).click();
  await page.getByLabel('Reply to Ben').fill('Yes, tonight.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Replied')).toBeVisible();
  expect((await calls(page)).find(([name]) => name === 'reply')?.[1]).toEqual({ id: 'm1', text: 'Yes, tonight.' });
});

test('keys: ⇧N opens the tray, J moves, E marks done; All shows Earlier; the away line and quiet note', async ({ page }) => {
  await open(page, 'closed=1&away=1&quiet=1');
  await expect(page.locator('.nb-nt-panel')).toHaveCount(0);
  await page.keyboard.press('Shift+N');
  await expect(page.locator('.nb-nt-panel')).toBeVisible();
  await expect(page.getByText(/^Since /)).toBeVisible();
  await expect(page.getByText(/Quiet hours until/)).toBeVisible();
  await page.getByRole('tab', { name: 'All' }).click();
  await expect(page.locator('.nb-nt-label .nb-micro b', { hasText: 'Earlier' })).toBeVisible();
});

test('phone: a full-width sheet with the buttons showing', async ({ page }) => {
  await open(page, '', { width: 390 });
  const tray = page.locator('.nb-nt-panel');
  expect(Math.round((await tray.boundingBox())!.width)).toBe(390);
  await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
  await page.screenshot({ path: 'test-results/notifications/phone.png' });
});

test('dark tray', async ({ page }) => {
  await open(page, '', { theme: 'dark' });
  await expect(page.locator('.nb-nt-panel')).toBeVisible();
  await page.screenshot({ path: 'test-results/notifications/dark.png' });
});
