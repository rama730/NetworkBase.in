import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B5.5a (report 34.6).
async function open(page: Page, organiser: boolean) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript((organiser) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const flags = organiser ? { organisers: 1, lastActivity: null, needsCoOrganiser: true, dormant: false } : {};
    (window as any).__actions = {
      readChaptersAction: async () => ({ success: true, organiser, canPropose: true, settings: organiser ? { proposeBy: 'members', dormantDays: 180, kitAbout: '' } : null, mine: [],
        chapters: [{ id: 'c1', title: 'Pune', slug: 'pune', kind: 'local', place: 'Pune', members: 64, nextEvent: null, closed: false, ...flags }],
        proposals: [{ id: 'p1', name: 'Embedded Rust', kind: 'topic', place: 'Embedded', why: 'Lots of us do it', by: 'u' }] }),
      proposeChapterAction: async (_o: string, v: unknown) => { calls.push(['propose', v]); return { success: true }; },
      decideChapterProposalAction: async (_o: string, id: string, v: unknown) => { calls.push(['decide', id, v]); return { success: true }; },
      saveChapterSettingsAction: async () => ({ success: true }),
    };
  }, organiser);
  await openApp(page, 'tests/browser/community-chapters.fixture.tsx', { path: '/' });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Organisers see flags as words and decide proposals (a decline needs a reason)', async ({ page }) => {
  await open(page, true);
  await expect(page.getByTestId('chapter-row')).toContainText('Needs a co-organiser');
  const props = page.getByTestId('chapter-proposals');
  await expect(props.getByRole('button', { name: 'Decline' })).toBeDisabled();
  await props.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['decide', 'p1', { approve: true, reason: null }]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('Members see chapters without flags and propose one', async ({ page }) => {
  await open(page, false);
  await expect(page.getByTestId('chapter-row')).not.toContainText('co-organiser');
  await page.getByRole('button', { name: 'Propose a chapter' }).click();
  const f = page.getByTestId('propose-chapter');
  await f.getByLabel('Name').fill('Bangalore');
  await f.getByLabel('City').fill('Bengaluru');
  await page.getByRole('button', { name: 'Send proposal' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['propose', { name: 'Bangalore', kind: 'local', place: 'Bengaluru', why: '', coOrganiserId: null }]);
});
