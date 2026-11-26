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
      readChallengeEntriesAction: async () => ({ success: true, canFeature: organiser, entries: [{ id: 'e1', challenge: 'Build a CLI in a weekend', title: 'tz-now', line: 'Time zones at a glance', link: 'https://example.com/tz', text: null, maker: 'Mei', mine: false, featured: false, why: null, isPublic: true }] }),
      readPromptsAction: async () => ({ success: true, canEdit: organiser, prompts: [{ position: 1, opensAt: '2026-11-20T09:00:00.000Z', open: true, title: 'Pick a problem', body: null }, { position: 2, opensAt: '2026-12-20T09:00:00.000Z', open: false, title: organiser ? 'Secret twist' : null, body: null }] }),
      savePromptsAction: async () => ({ success: true }),
      featureEntryAction: async (_o: string, id: string, why: string | null) => { calls.push(['feature', id, why]); return { success: true }; },
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
  await expect(page.getByTestId('challenge-prompts').first()).toContainText('Day 1 Pick a problem');
  await expect(page.getByTestId('challenge-prompts').first()).toContainText(/Day 2 Opens/);
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

test('Organisers feature an entry with a Why we love it line', async ({ page }) => {
  await open(page, true, null);
  await page.getByTestId('challenge-card').first().getByRole('button', { name: 'See entries' }).click();
  const entry = page.getByTestId('entry-card').first();
  await expect(entry).toContainText('tz-now');
  await entry.getByLabel('Why we love tz-now').fill('tiny and useful');
  await entry.getByRole('button', { name: 'Feature' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['feature', 'e1', 'tiny and useful']);
});
