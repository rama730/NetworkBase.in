import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B5.4d (report 34.5).
async function open(page: Page) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readRitualsAction: async () => ({ success: true, canEdit: true, rituals: [{ id: 'wins', name: 'Weekly wins', kind: 'thread', freq: 'weekly', weekday: 5, time: '17:00', hostId: '00000000-0000-4000-8000-000000000001', prompt: 'Share a win', leadDays: 0, paused: false, host: 'Asha', repeat: 'Every Friday at 17:00', next: '2026-11-27T11:30:00.000Z' }] }),
      saveRitualAction: async (_o: string, v: unknown) => { calls.push(['save', v]); return { success: true }; },
      removeRitualAction: async (_o: string, id: string) => { calls.push(['remove', id]); return { success: true }; },
    };
  });
  await openApp(page, 'tests/browser/community-rituals.fixture.tsx', { path: '/' });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Rituals: the list with repeat in words, host and next date; pause; add Ask me anything', async ({ page }) => {
  await open(page);
  const row = page.getByTestId('ritual-row');
  await expect(row).toContainText('Thread · Every Friday at 17:00 · Host: Asha');
  await row.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => JSON.stringify(await calls(page))).toContain('"paused":true');
  await page.getByRole('button', { name: 'Add Ask me anything' }).click();
  await expect(page.getByTestId('ritual-form').getByLabel('Name')).toHaveValue('Ask me anything');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => JSON.stringify(await calls(page))).toContain('"kind":"ama"');
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});
