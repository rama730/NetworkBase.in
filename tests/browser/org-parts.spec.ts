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
      readBoardMeetingsAction: async () => ({ success: true, canPlan: true, meetings: [{ slug: 'board-jan', title: 'Board · Jan', startsAt: '2099-01-07T10:00:00.000Z', approved: true }] }),
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

// Plan B8.5 (the Nonprofit kit): board meetings on Overview.
test('Board meetings: the list links to each meeting, says when minutes are approved, and offers Plan a board meeting', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.addInitScript(() => {
    (window as any).__actions = {
      readPartsAction: async () => ({ success: true, kit: 'nonprofit', kits: [], parts: [] }),
      readBoardMeetingsAction: async () => ({ success: true, canPlan: true, meetings: [{ slug: 'board-jan', title: 'Board · Jan', startsAt: '2099-01-07T10:00:00.000Z', approved: true }] }),
    };
  });
  await openApp(page, 'tests/browser/org-parts.fixture.tsx');
  const card = page.getByTestId('board-meetings');
  await expect(card.getByRole('link', { name: 'Board · Jan' })).toHaveAttribute('href', '/org/wt?tab=docs&doc=board-jan');
  await expect(card.getByTestId('board-meeting')).toContainText('Minutes approved');
  await expect(card.getByRole('button', { name: 'Plan a board meeting' })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

// Plan B8.9 (the Faith kit): an Other organization's Workspaces add Small groups, without Chapters.
test('Small groups: Workspaces shows Groups beside the list, no Chapters, and members can start one', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.addInitScript(() => {
    (window as any).__groups = true;
    (window as any).__actions = {
      readPartsAction: async () => ({ success: true, kit: 'faith', kits: [], parts: [] }),
      readBoardMeetingsAction: async () => ({ success: false, error: 'off' }),
      readGroupsAction: async () => ({ success: true, canStart: true, club: false, groups: [] }),
    };
  });
  await openApp(page, 'tests/browser/org-parts.fixture.tsx');
  const views = page.getByRole('group', { name: 'Workspaces views' });
  await expect(views.getByRole('button')).toHaveText(['Workspaces', 'Groups']);
  await views.getByRole('button', { name: 'Groups' }).click();
  await expect(page.getByTestId('community-groups').getByRole('button', { name: 'Start a group' })).toBeVisible();
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

