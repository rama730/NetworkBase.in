import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B5.4a (report 34.5).
async function open(page: Page, organiser: boolean, mine: null | { id: string; handedIn: boolean }) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(({ organiser, mine }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const closes = new Date(Date.now() + 4 * 86_400_000).toISOString();
    (window as any).__actions = {
      readChallengesAction: async () => ({ success: true, canStart: organiser, canJoin: !organiser, challenges: [
        { id: 'c1', title: 'Build a CLI in a weekend', description: 'Make a tool you’d use every day.', closes, open: true, joined: 86, entries: 41, mine },
        { id: 'c0', title: 'October: tiny games', description: null, closes: '2026-10-31T23:00:00.000Z', open: false, joined: 40, entries: 22, mine: null },
      ] }),
      joinChallengeAction: async (_o: string, id: string) => { calls.push(['join', id]); return { success: true, copyId: 'copy1' }; },
      leaveChallengeAction: async (_o: string, id: string) => { calls.push(['leave', id]); return { success: true }; },
      createAssignmentAction: async (v: unknown) => { calls.push(['create', v]); return { success: true, masterId: 'c2' }; },
    };
  }, { organiser, mine });
  await openApp(page, 'tests/browser/community-challenges.fixture.tsx', { path: '/' });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Members join an open challenge; past challenges show Closed; no Missing anywhere', async ({ page }) => {
  await open(page, false, null);
  await expect(page.getByTestId('current-challenge')).toContainText('Build a CLI in a weekend');
  const card = page.getByTestId('challenge-card').first();
  await expect(card).toContainText('86 joined · 41 entries');
  await card.getByRole('button', { name: 'Join the challenge' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['join', 'c1']);
  await expect(page.getByTestId('challenge-card').nth(1)).toContainText('Closed');
  await expect(page.getByText(/missing|overdue/i)).toHaveCount(0);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('A joined member hands in or leaves; organisers start a challenge as an optional assignment', async ({ page }) => {
  await open(page, false, { id: 'copy1', handedIn: false });
  const card = page.getByTestId('challenge-card').first();
  await expect(card.getByRole('link', { name: 'Hand in' })).toHaveAttribute('href', '/org/devs?tab=tasks&taskId=copy1');
  await card.getByRole('button', { name: 'Leave' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['leave', 'c1']);
  await open(page, true, null);
  await page.getByRole('button', { name: 'Start a challenge' }).click();
  await page.getByTestId('start-challenge').getByLabel('Title').fill('December: tiny tools');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect.poll(async () => JSON.stringify(await calls(page))).toContain('"target":{"mode":"optional"}');
});
