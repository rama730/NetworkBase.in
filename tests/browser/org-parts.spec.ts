import { expect, test } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

test.use({ reducedMotion: 'reduce' });

// Plan B8.4a (report 37.2 call 5, layer 6): a workflow row shows On or Off, and "has data" when off.
test('Settings → Workflows: On, Off with "has data", Turn on and Turn off', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readPartsAction: async () => ({ success: true, kit: null, kits: [], parts: [
        { id: 'volunteers', name: 'Volunteers and shifts', line: 'Roles, shifts, check-in and hours (X2).', where: 'Overview', ready: true, on: true, hasData: false },
        { id: 'programs', name: 'Programs and impact', line: 'Programs with measures (X4).', where: 'Overview', ready: true, on: false, hasData: true }] }),
      setPartAction: async (_o: string, p: string, on: boolean) => { calls.push(['part', p, on]); return { success: true }; },
    };
  });
  await openApp(page, 'tests/browser/org-parts.fixture.tsx');
  const rows = page.getByTestId('org-part');
  await expect(rows.nth(0)).toContainText('On');
  await expect(rows.nth(1)).toContainText('Off · has data');
  await rows.nth(1).getByRole('button', { name: 'Turn on Programs and impact' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['part', 'programs', true]);
  await rows.nth(0).getByRole('button', { name: 'Turn off Volunteers and shifts' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['part', 'volunteers', false]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});
