import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B5.2 (report 34.3).
const card = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, username: null, avatarUrl: null, place: 'Bangalore', interests: ['rust'], askMeAbout: [], hereFor: null, joined: '2026-01-10T00:00:00Z', isNew: false, organiser: false, labels: [], posts: 3, ...extra });
async function open(page: Page, view: string, organiser: boolean) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(({ organiser, card }) => {
    const mk = new Function('return ' + card)();
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const people = [mk('b', 'Dev', { labels: ['helper'], posts: 31 }), mk('c', 'Mei', { isNew: true, interests: ['embedded'], place: 'Online', posts: null, hereFor: 'first Rust job' })];
    (window as any).__actions = {
      readCommunityDirectoryAction: async () => ({ success: true, organiser, moderator: !organiser, helperWord: 'Helper', me: { ...mk('a', 'Priya'), hidden: false, hideCounts: false, interests: [] }, people }),
      saveMyCommunityCardAction: async (_o: string, v: unknown) => { calls.push(['card', v]); return { success: true }; },
      readCommunityPeopleAction: async () => ({ success: true, counts: { new: 1, active: 1, quiet: 1 }, settings: { quietDays: 60, helperWord: 'Helper', pauseHours: [24, 168] },
        people: [{ ...mk('b', 'Dev', { labels: ['helper'] }), status: 'quiet', hidden: false, answers: {}, lastActive: null, postsAll: 31 }, { ...mk('c', 'Mei', { isNew: true }), status: 'new', hidden: true, answers: { why: 'first Rust job' }, lastActive: null, postsAll: 0 }] }),
      setCommunityLabelAction: async (_o: string, p: string, l: string, on: boolean) => { calls.push(['label', p, l, on]); return { success: true }; },
      readCommunityLogAction: async () => ({ success: true, helperWord: 'Helper', entries: [] }),
      readCommunityModerationAction: async () => ({ success: true, organiser, pauseHours: [24, 168], rules: [{ n: 1, text: 'Be kind' }, { n: 2, text: 'No spam' }],
        cases: [{ id: 'k1', number: 1003, label: 'Post by Dev', href: null, reports: 2, content: 'selling courses', details: null, deadline: null }] }),
      moderateCommunityReportAction: async (_o: string, id: string, v: unknown) => { calls.push(['mod', id, v]); return { success: true }; },
      saveCommunityMembersSettingsAction: async (_o: string, v: unknown) => { calls.push(['settings', v]); return { success: true }; },
    };
  }, { organiser, card: card.toString() });
  await openApp(page, 'tests/browser/community-members.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Directory: own card first with its switches; search and filter by interest; New and Helper as words; hidden counts stay hidden', async ({ page }) => {
  await open(page, 'members', false);
  const cards = page.getByTestId('community-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText('Priya (you)');
  await expect(page.getByRole('link', { name: 'Add your interests' })).toBeVisible();
  await expect(cards.nth(1)).toContainText('Helper');
  await expect(cards.nth(2)).toContainText('New');
  await expect(cards.nth(2)).not.toContainText('posts');
  await expect(page.getByText('Quiet')).toHaveCount(0);
  await page.getByLabel('Search people or interests').fill('embedded');
  await expect(cards).toHaveCount(2);
  await page.getByLabel('Show me in the directory').uncheck();
  await expect.poll(() => calls(page)).toContainEqual(['card', { hidden: true, hideCounts: false }]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('People (organisers): New · Active · Quiet as words; give a role; Moderation with a rule and a pause length', async ({ page }) => {
  await open(page, 'members', true);
  await page.getByRole('tab', { name: 'People' }).click();
  await expect(page.getByText('New 1 · Active 1 · Quiet 1')).toBeVisible();
  await expect(page.getByTestId('community-person').first()).toContainText('Quiet');
  await page.getByRole('group', { name: 'Roles for Dev' }).getByLabel('Moderator').check();
  await expect.poll(() => calls(page)).toContainEqual(['label', 'b', 'moderator', true]);
  await page.getByRole('tab', { name: 'Moderation' }).click();
  await page.getByLabel('Rule broken').selectOption('2');
  await page.getByLabel('Pause length').selectOption('168');
  await page.getByRole('button', { name: 'Pause posting' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['mod', 'k1', { choice: 'pause', rule: 2, hours: 168 }]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('A moderator sees Moderation, not People; Settings → Members saves', async ({ page }) => {
  await open(page, 'members', false);
  await expect(page.getByRole('tab', { name: 'Moderation' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'People' })).toHaveCount(0);
  await open(page, 'settings', true);
  await page.getByLabel('Quiet after (days)').fill('90');
  await page.getByRole('button', { name: 'Save members settings' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['settings', { quietDays: 90, helperWord: 'Helper', pauseHours: [24, 168] }]);
});
