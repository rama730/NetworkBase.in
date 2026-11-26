import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B5.5a (report 34.6).
async function open(page: Page, organiser: boolean, view = 'chapters') {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript((organiser) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const flags = organiser ? { organisers: 1, lastActivity: null, needsCoOrganiser: true, dormant: false, events90d: 3, openReports: 1 } : {};
    (window as any).__actions = {
      readChaptersAction: async () => ({ success: true, organiser, canPropose: true, settings: organiser ? { proposeBy: 'members', dormantDays: 180, kitAbout: '' } : null, mine: [],
        chapters: [{ id: 'c1', title: 'Pune', slug: 'pune', kind: 'local', place: 'Pune', members: 64, nextEvent: null, closed: false, ...flags }],
        proposals: [{ id: 'p1', name: 'Embedded Rust', kind: 'topic', place: 'Embedded', why: 'Lots of us do it', by: 'u' }] }),
      proposeChapterAction: async (_o: string, v: unknown) => { calls.push(['propose', v]); return { success: true }; },
      decideChapterProposalAction: async (_o: string, id: string, v: unknown) => { calls.push(['decide', id, v]); return { success: true }; },
      saveChapterSettingsAction: async () => ({ success: true }),
      readChapterKitAction: async () => ({ success: true, budget: 40000, kit: null, docs: [{ id: 'd1', filename: 'Organiser guide.md', size: 1200 }, { id: 'd2', filename: 'Venue checklist.md', size: 900 }] }),
      saveChapterKitAction: async (_o: string, v: unknown) => { calls.push(['kit', v]); return { success: true }; },
      readGroupsAction: async () => ({ success: true, canStart: true, groups: [
        { id: 'g1', title: 'Rustlings study group', slug: 'g1', kind: 'study', meets: 'Tuesdays 20:00', purpose: '', cap: 10, join: 'open', chapter: 'Bangalore', members: 7, mine: false, asked: false, host: false, requests: [], requestNames: [] },
        { id: 'g2', title: 'Async book club', slug: 'g2', kind: 'book', meets: 'monthly', purpose: '', cap: 10, join: 'ask', chapter: null, members: 10, mine: false, asked: false, host: false, requests: [], requestNames: [] },
        { id: 'g3', title: 'Founders circle', slug: 'g3', kind: 'accountability', meets: 'Fridays', purpose: '', cap: 8, join: 'ask', chapter: null, members: 6, mine: true, asked: false, host: true, requests: ['u9'], requestNames: ['Mei'] }] }),
      joinGroupAction: async (_o: string, id: string) => { calls.push(['join', id]); return { success: true, outcome: 'joined' }; },
      answerGroupRequestAction: async (_o: string, g: string, p: string, ok: boolean) => { calls.push(['answer', g, p, ok]); return { success: true }; },
      startGroupAction: async () => ({ success: true, id: 'g4', slug: 'g4' }),
      readGroupPollsAction: async () => ({ success: true, isGroup: true, host: true, polls: [{ id: 'p1', question: 'When should we meet?', kind: 'times', closesAt: new Date(Date.now() + 864e5).toISOString(), open: true, picked: null, canPick: true,
        options: [{ label: 'Tue 20:00', count: 5, mine: true, who: ['Mei'] }, { label: 'Wed 19:00', count: 2, mine: false, who: [] }] }] }),
      voteGroupPollAction: async (_g: string, p: string, o: number, on: boolean) => { calls.push(['vote', p, o, on]); return { success: true }; },
      pickGroupPollAction: async (_g: string, p: string, o: number) => { calls.push(['pick', p, o]); return { success: true }; },
      createGroupPollAction: async () => ({ success: true }),
    };
  }, organiser);
  await openApp(page, 'tests/browser/community-chapters.fixture.tsx', { path: `/?view=${view}` });
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

test('Groups: 7 of 10 with Join; Full; hosts accept an Ask', async ({ page }) => {
  await open(page, false, 'groups');
  const cards = page.getByTestId('group-card');
  await expect(cards.nth(0)).toContainText('Study group · 7 of 10 · Tuesdays 20:00 · Bangalore');
  await expect(cards.nth(1)).toContainText('Full');
  await cards.nth(0).getByRole('button', { name: 'Join' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['join', 'g1']);
  await cards.nth(2).getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['answer', 'g3', 'u9', true]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('Polls: counts as text beside the bars; tick and pick', async ({ page }) => {
  await open(page, false, 'polls');
  const poll = page.getByTestId('group-poll');
  await expect(poll).toContainText('When should we meet?');
  await expect(poll).toContainText('5');
  await poll.getByLabel('Wed 19:00').check();
  await expect.poll(() => calls(page)).toContainEqual(['vote', 'p1', 1, true]);
  await poll.getByRole('button', { name: 'Pick' }).first().click();
  await expect.poll(() => calls(page)).toContainEqual(['pick', 'p1', 0]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('Organisers see health as counts and save the Chapter kit from chosen documents', async ({ page }) => {
  await open(page, true);
  await expect(page.getByTestId('chapter-row')).toContainText('3 events in 90 days · 1 open report');
  await page.getByRole('button', { name: 'Chapter settings' }).click();
  const kit = page.getByTestId('chapter-kit');
  await expect(kit).toContainText('No kit saved yet');
  await kit.getByLabel('Organiser guide.md').check();
  await kit.getByRole('button', { name: 'Save the kit from this community' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['kit', { docIds: ['d1'] }]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});
