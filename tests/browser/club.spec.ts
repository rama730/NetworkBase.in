import { expect, test } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B7.1a (report 36.2 calls 3, 4, 7).
test('Club recruiting: the banner while it lasts, the officers card with drive counts, the join poster with link and code (no QR)', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readRecruitingAction: async () => ({ success: true, officer: true, recruiting: true, line: 'Taster night Thursday', to: '2026-09-14', firstEvent: { title: 'Taster night', at: null },
        settings: { from: '2026-09-01', to: '2026-09-14', line: 'Taster night Thursday', firstEventId: 'e1' }, poster: { title: 'WT Robotics Club', slug: 'wt-robotics', code: 'RBT123' } }),
      readDriveCountsAction: async () => ({ success: true, counts: { joined: 12, came: 7, from: '2026-09-01', to: '2026-09-14' } }),
      readCommunityEventsAction: async () => ({ success: true, member: true, canCreate: true, events: [{ id: 'e1', title: 'Taster night', state: 'upcoming' }] }),
      saveRecruitingAction: async (_o: string, v: unknown) => { calls.push(['save', v]); return { success: true }; },
      readRenewalAction: async () => ({ success: true, on: true, officer: true, season: '2026-09-01', ask: 'Staying this Season?', days: 30, closed: true, mine: 'not_answered',
        people: [{ id: 'u1', name: 'Asha', officer: true, state: 'staying' }, { id: 'u2', name: 'Ben', officer: false, state: 'leaving' }, { id: 'u3', name: 'Cal', officer: false, state: 'not_answered' }, { id: 'u4', name: 'Dev', officer: false, state: 'not_asked' }] }),
      answerRenewalAction: async (_o: string, a: string) => { calls.push(['answer', a]); return { success: true }; },
      endNotRenewedAction: async () => { calls.push(['end']); return { success: true, ended: 2 }; },
      saveRenewalAction: async () => ({ success: true }),
    };
  });
  await openApp(page, 'tests/browser/club.fixture.tsx');
  await expect(page.getByTestId('club-recruiting-banner')).toContainText('Recruiting now');
  await expect(page.getByTestId('club-recruiting-banner')).toContainText('until 14 September 2026');
  await expect(page.getByTestId('club-drive-counts')).toHaveText('During the drive (1 September 2026 to 14 September 2026): 12 joined, 7 of them came to an event.');
  const card = page.getByTestId('club-recruiting');
  await card.getByLabel('Banner line').fill('Build a robot this term');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['save', { from: '2026-09-01', to: '2026-09-14', line: 'Build a robot this term', firstEventId: 'e1' }]);
  await page.evaluate(() => { (window as any).print = () => { (window as any).__printed = document.getElementById('nb-join-poster')?.innerText ?? ''; }; });
  await card.getByRole('button', { name: 'Print the join poster' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toContain('networkbase.in/org/wt-robotics');
  expect(await page.evaluate(() => (window as any).__printed)).toContain('RBT123');
  expect(await page.locator('#nb-join-poster img, #nb-join-poster canvas, #nb-join-poster svg').count()).toBe(0);
  expect(await axeViolations(page)).toEqual([]);
});

test('Season renewal: the member ask, officers see counts and end only after a confirm, never officers', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readRecruitingAction: async () => ({ success: true, officer: false, recruiting: false, line: null, to: null, firstEvent: null, settings: null, poster: null }),
      readRenewalAction: async () => ({ success: true, on: true, officer: true, season: '2026-09-01', ask: 'Staying this Season?', days: 30, closed: true, mine: 'not_answered',
        people: [{ id: 'u1', name: 'Asha', officer: true, state: 'staying' }, { id: 'u2', name: 'Ben', officer: false, state: 'leaving' }, { id: 'u3', name: 'Cal', officer: false, state: 'not_answered' }, { id: 'u4', name: 'Dev', officer: false, state: 'not_asked' }] }),
      answerRenewalAction: async (_o: string, a: string) => { calls.push(['answer', a]); return { success: true }; },
      endNotRenewedAction: async () => { calls.push(['end']); return { success: true, ended: 2 }; },
      saveRenewalAction: async () => ({ success: true }),
    };
  });
  await openApp(page, 'tests/browser/club.fixture.tsx');
  const card = page.getByTestId('club-renewal');
  await expect(page.getByTestId('club-renewal-ask')).toContainText('Staying this Season?');
  await page.getByTestId('club-renewal-ask').getByRole('button', { name: 'Staying' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['answer', 'staying']);
  await expect(page.getByTestId('club-renewal-counts')).toHaveText('Season from 1 September 2026: 1 Staying, 1 Not answered, 1 Leaving, 1 joined this Season.');
  await card.getByRole('button', { name: 'End memberships not renewed' }).click();
  await expect(card).toContainText('End 2 memberships as Season ended? Officers are never included.');
  await card.getByRole('button', { name: 'End 2' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['end']);
  expect(await axeViolations(page)).toEqual([]);
});
