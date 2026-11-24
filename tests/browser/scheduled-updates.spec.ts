import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.17 W2, W5, W6 (plan A7.4, A7.5).
async function open(page: Page, view: string, width = 1000) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readScheduledUpdatesAction: async () => ({ success: true, me: 'u1', canManage: false, scheduled: [
        { id: 's1', content: 'WT launch notes', updateType: null, visibility: 'public', publishAt: '2026-12-03T04:30:00Z', failedReason: null, authorId: 'u1', authorName: 'Asha' },
        { id: 's2', content: 'Dev’s weekly', updateType: null, visibility: 'members', publishAt: '2026-12-04T04:30:00Z', failedReason: 'You don’t have access to post updates here.', authorId: 'u2', authorName: 'Dev' },
      ] }),
      postScheduledNowAction: async (_p: string, id: string) => { calls.push(['now', id]); return { success: true, updateId: 'u9' }; },
      cancelScheduledUpdateAction: async (_p: string, id: string) => { calls.push(['cancel', id]); return { success: true }; },
      editScheduledUpdateAction: async (_p: string, id: string, input: unknown) => { calls.push(['edit', id, input]); return { success: true }; },
      readWorkspaceUpdatesAction: async () => ({ success: true, data: { nextCursor: null, updates: [
        { id: 'r1', createdAt: '2026-11-24T10:00:00Z', content: '## v2.4\n\n### Added\n- Docs site\n- Snippets\n\n### Fixed\n- Push of SVG files' },
        { id: 'r2', createdAt: '2026-11-10T10:00:00Z', content: 'Big release this week, thanks all.' },
      ] } }),
    };
  });
  await openApp(page, 'tests/browser/scheduled-updates.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('W2: Scheduled lists what waits; its author edits or posts now; a failed one says why; others can only see it', async ({ page }) => {
  await open(page, 'scheduled');
  const rows = page.getByTestId('scheduled-update');
  await expect(rows.first()).toContainText(/Posts .*·\s*Public\s*·\s*Asha\s*WT launch notes/);
  await expect(rows.nth(1)).toContainText(/Didn’t post\s*·\s*Members\s*·\s*Dev.*You don’t have access/);
  await expect(rows.nth(1).getByRole('button')).toHaveCount(0);
  await rows.first().getByRole('button', { name: 'Post now' }).click();
  await rows.first().getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Update text').fill('WT launch notes, final');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => calls(page)).toEqual([['now', 's1'], ['edit', 's1', expect.objectContaining({ content: 'WT launch notes, final' })]]);
  expect(await axeViolations(page)).toEqual([]);
});

test('W5/W6: the Changelog shows versions with Added and Fixed; a hand-written release stays one block; phone', async ({ page }) => {
  await open(page, 'changelog', 375);
  const releases = page.getByTestId('changelog-release');
  await expect(releases.first()).toContainText(/v2\.4 · .*2026\s*Added\s*Docs site\s*Snippets\s*Fixed\s*Push of SVG files/);
  await expect(releases.first()).not.toContainText('Improved');
  await expect(releases.nth(1)).toContainText('Big release this week, thanks all.');
  await page.screenshot({ path: 'test-results/scheduled-updates/changelog.png' });
  expect(await axeViolations(page)).toEqual([]);
});
