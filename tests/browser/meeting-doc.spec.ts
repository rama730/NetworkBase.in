import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.11 D1 W1, W3, W5, W8, W9 (plan A4.1).
async function open(page: Page, opts: { view?: string; now?: string; finished?: boolean; series?: boolean; board?: boolean; settings?: boolean; amend?: boolean } = {}) {
  await page.clock.setFixedTime(new Date(opts.now ?? '2027-01-07T04:40:00Z'));
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(({ finished, series, board, settings, amend }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readMeetingAction: async () => ({ success: true, canEdit: true, member: true, type: 'blank', title: 'Weekly · Jan 7', startsAt: '2027-01-07T04:30:00.000Z', lengthMinutes: 30,
        timeZone: 'Asia/Kolkata', attendees: [{ id: 'u2', name: 'Dev', avatarUrl: null }], seriesRule: series ? 'weekly' : null, seriesTitle: series ? 'Weekly' : null, seriesId: series ? 's1' : null,
        finishedAt: finished ? '2027-01-07T05:00:00.000Z' : null, openActionItems: 0,
        ...(board ? { type: 'board', attendees: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Asha', avatarUrl: null }, { id: '22222222-2222-4222-8222-222222222222', name: 'Dev', avatarUrl: null }, { id: '33333333-3333-4333-8333-333333333333', name: 'Mia', avatarUrl: null }],
          board: { needed: 2, motionsOn: true, amendments: amend ? { version: 4, articles: [{ n: '1', title: 'Name' }, { n: '6', title: 'Amendments' }], threshold: 2 / 3 } : null, size: 3, present: (window as any).__present ?? [], presentCount: ((window as any).__present ?? []).length, approvedAt: null, toApprove: { slug: 'board-dec', title: 'Board · Dec 7' },
            motions: [{ id: 'm1', text: 'Approve the 2027 budget', proposedBy: '11111111-1111-4111-8111-111111111111', secondedBy: '22222222-2222-4222-8222-222222222222', votes: null, result: null, decision: null },
              { id: 'm2', text: 'Move the office', proposedBy: null, secondedBy: null, votes: { for: 1, against: 2, abstain: 0 }, result: 'failed', decision: null }] } } : {}) }),
      markPresentAction: async (_p: string, input: { present: string[] }) => { calls.push(['present', input.present.length]); (window as any).__present = input.present; return { success: true, present: input.present }; },
      recordVoteAction: async (_p: string, input: unknown) => { calls.push(['vote', input]); return { success: true, result: 'failed' }; },
      addMotionAction: async (_p: string, input: unknown) => { calls.push(['motion', input]); return { success: true, motionId: 'm3' }; },
      approveMinutesAction: async (_p: string, input: unknown) => { calls.push(['approve', input]); return { success: true, approvedSlug: 'board-dec', approvedAt: '2027-01-07T05:00:00.000Z' }; },
      readMeetingFeedAction: async () => ({ success: true, hasLink: false, since: null }),
      newMeetingFeedAction: async () => { calls.push(['feed']); return { success: true, path: '/api/feeds/meetings/abcdefghijklmnopqrstuvwx' }; },
      readMeetingsAction: async () => ({ success: true, projectKey: 'AC', timeZone: 'Asia/Kolkata', viewerId: 'u1',
        meetings: [{ docId: 'd1', slug: 'weekly-jan-7', title: 'Weekly · Jan 7', type: 'blank', startsAt: '2027-01-07T04:30:00.000Z', lengthMinutes: 30, attendeeIds: ['u2'], finished: false },
          { docId: 'd2', slug: 'retro', title: 'Retro', type: 'blank', startsAt: '2027-01-07T09:00:00.000Z', lengthMinutes: 60, attendeeIds: [], finished: true }], people: [{ id: 'u1', name: 'Asha' }, { id: 'u2', name: 'Dev' }],
        ...(settings ? { settings: { types: ['weekly', 'blank'], lengthMinutes: 45, reminderMinutes: 0 } } : {}),
        openActionItems: [{ id: 't1', number: 5, title: 'Fix the login typo', status: 'todo', dueDate: '2027-01-10', assigneeId: 'u2', assigneeName: 'Dev', meeting: { slug: 'weekly-jan-7', title: 'Weekly · Jan 7' } }] }),
      finishMeetingAction: async (_p: string, input: unknown) => { calls.push(['finish', input]); return { success: true, alreadyFinished: false, next: null }; },
      moveMeetingAction: async (_p: string, input: unknown) => { calls.push(['move', input]); return { success: true }; },
      readDocRowsAction: async () => ({ success: true, hidden: 0, canAdd: true, canSeeTasks: true, projectKey: 'AC', member: true, canPlanSprints: true,
        rows: [{ id: 'a', number: 1, title: 'One', status: 'todo', reviewStatus: 'none', dueDate: null, completedAt: null, position: 1, itemType: 'task', assignee: null, canTick: true },
          { id: 'b', number: 2, title: 'Two', status: 'in_progress', reviewStatus: 'none', dueDate: null, completedAt: null, position: 2, itemType: 'task', assignee: null, canTick: true },
          { id: 'c', number: 3, title: 'Three', status: 'done', reviewStatus: 'none', dueDate: null, completedAt: null, position: 3, itemType: 'task', assignee: null, canTick: true }] }),
      endSeriesAction: async (_p: string, input: unknown) => { calls.push(['end', input]); return { success: true }; },
    };
  }, { finished: opts.finished ?? false, series: opts.series ?? false, board: opts.board ?? false, settings: opts.settings ?? false, amend: opts.amend ?? false });
  await openApp(page, 'tests/browser/meeting-doc.fixture.tsx', opts.view ? { path: `/?view=${opts.view}` } : undefined);
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('S2 and W3: when in full with the zone, type, attendees, Now during the meeting, Finish meeting; no axe violations', async ({ page }) => {
  await open(page, { series: true });
  const h = page.getByTestId('meeting-header');
  await expect(h.getByTestId('meeting-when')).toHaveText('Thu 7 Jan · 10:00–10:30 (Asia/Kolkata)');
  await expect(h).toContainText(/Blank.*Every week.*Now/);
  await expect(h.getByTestId('meeting-attendees-line')).toHaveText('Attendees: Dev · 2 open action items');
  expect(await axeViolations(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/meeting-doc/header.png' });
});

test('W5: Finish meeting (no series) leaves open items on the board; W8: Edit this meeting moves only this one', async ({ page }) => {
  await open(page, { now: '2027-01-06T04:40:00Z' });
  await expect(page.getByTestId('meeting-header')).not.toContainText('Now');
  await page.getByRole('button', { name: 'Finish meeting' }).click();
  const d = page.getByTestId('finish-meeting-dialog');
  await expect(d).toContainText('This meeting doesn’t repeat.');
  await expect(d).toContainText('2 action items stay open on the Tasks board.');
  await d.getByRole('button', { name: 'Finish' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['finish', { docSlug: 'weekly-jan-7', carryOver: true }]);
  await page.getByRole('button', { name: 'Meeting actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit this meeting…' }).click();
  const m = page.getByTestId('move-meeting-dialog');
  await m.getByLabel('Time (Asia/Kolkata)').fill('11:30');
  await m.getByRole('button', { name: 'Move' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['move', { docSlug: 'weekly-jan-7', startsAt: '2027-01-07T06:00:00.000Z' }]);
});

test('A finished meeting says Finished and offers no Finish', async ({ page }) => {
  await open(page, { finished: true });
  await expect(page.getByTestId('meeting-header')).toContainText('Finished');
  await expect(page.getByRole('button', { name: 'Finish meeting' })).toHaveCount(0);
});

test('S1: New meeting has type, default title, date and time in the zone, length, repeat and member attendees', async ({ page }) => {
  await open(page, { view: 'new' });
  const d = page.getByTestId('new-meeting-dialog');
  // A4.3–A4.14: type cards with an icon and one line; Weekly first, Blank last; the title follows the type.
  const types = d.getByRole('radiogroup', { name: 'Type' }).getByRole('radio');
  await expect(types).toHaveCount(22); // every catalog type when Settings → Meetings has none set (the mock); clubs and schools added theirs
  await expect(types.first()).toHaveAttribute('aria-checked', 'true');
  await expect(types.first()).toContainText('WeeklyAgenda, notes, decisions and action items.');
  await expect(d.getByLabel('Title')).toHaveAttribute('placeholder', 'Weekly · Jan 7');
  await d.getByRole('radio', { name: /Standup/ }).click();
  await expect(d.getByRole('radio', { name: /Standup/ })).toHaveAttribute('aria-checked', 'true');
  await expect(d.getByLabel('Title')).toHaveAttribute('placeholder', 'Standup · Jan 7');
  await d.getByRole('radio', { name: /Blank/ }).click();
  await expect(d.getByLabel('Title')).toHaveAttribute('placeholder', 'Meeting · Jan 7');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/meeting-doc/new-meeting-types.png' });
  await expect(d.getByLabel('Time (Asia/Kolkata)')).toHaveValue('10:00');
  await expect(d.getByLabel('Repeat')).toContainText('Every weekday');
  await expect(d.getByTestId('meeting-attendees')).toContainText(/Asha.*Dev/);
  expect(await axeViolations(page)).toEqual([]);
});

test('S6 and W9: Open action items lists item, assignee, due and meeting', async ({ page }) => {
  await open(page, { view: 'actions' });
  await expect(page.getByTestId('open-action-row')).toHaveText(/Fix the login typo.*Dev.*2027-01-10.*Weekly · Jan 7/);
  expect(await axeViolations(page)).toEqual([]);
});

test('S7 and W10: the Meetings calendar shows meetings on their days in time order; Get my link makes a calendar link', async ({ page }) => {
  await open(page, { view: 'calendar' });
  const cal = page.getByTestId('meetings-calendar');
  await expect(cal).toContainText('January 2027');
  const day = cal.getByRole('group', { name: 'Thursday 7 January' });
  await expect(day.getByTestId('calendar-meeting')).toHaveText(['10:00 Weekly · Jan 7', '14:30 Retro']);
  await cal.getByRole('button', { name: 'Next month' }).click();
  await expect(cal).toContainText('February 2027');
  await expect(cal.getByTestId('calendar-meeting')).toHaveCount(0);
  await cal.getByRole('button', { name: 'Get my link' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['feed']);
  await expect(cal.getByLabel('Your calendar link')).toHaveValue(/\/api\/feeds\/meetings\/abcdefghijklmnopqrstuvwx$/);
  expect(await axeViolations(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/meeting-doc/calendar.png' });
});

// Plan A4.9 (report 38.11 W6, S3).
test('W6 and S3: the board panel shows the quorum, present, motions with counts and result; Record vote needs quorum; + Motion; Approve last minutes', async ({ page }) => {
  await open(page, { board: true });
  const panel = page.getByTestId('board-panel');
  await expect(panel.getByTestId('board-quorum')).toHaveText('Quorum: 0 present of 3 · 2 needed · Not quorate');
  const motions = panel.getByTestId('motion');
  await expect(motions.first()).toContainText('Approve the 2027 budgetProposed by Asha · seconded by Dev');
  await expect(motions.nth(1)).toContainText(/Move the office\s*Failed/);
  await expect(motions.nth(1)).toContainText('For 1 · Against 2 · Abstain 0');
  await expect(motions.nth(1).getByRole('button', { name: 'Record vote' })).toHaveCount(0);
  // Not quorate: the vote can't be recorded.
  await motions.first().getByRole('button', { name: 'Record vote' }).click();
  const vote = page.getByTestId('vote-dialog');
  await expect(vote.getByRole('alert')).toHaveText("Not quorate: 0 present, 2 needed. Mark who's present first.");
  await expect(vote.getByRole('button', { name: 'Record vote' })).toBeDisabled();
  await vote.getByRole('button', { name: 'Cancel' }).click();
  // Mark two present → quorate; votes over those present are refused before sending.
  await panel.getByLabel('Asha').check();
  await expect(panel.getByTestId('board-quorum')).toContainText('1 present');
  await panel.getByLabel('Dev').check();
  await expect(panel.getByTestId('board-quorum')).toHaveText('Quorum: 2 present of 3 · 2 needed · Quorate');
  await motions.first().getByRole('button', { name: 'Record vote' }).click();
  await vote.getByLabel('For').fill('2');
  await vote.getByLabel('Abstain').fill('1');
  await expect(vote.getByRole('alert')).toHaveText('The votes add up to 3, more than the 2 present.');
  await vote.getByLabel('Abstain').fill('0');
  await vote.getByLabel('For').fill('0');
  await vote.getByLabel('Against').fill('2');
  await expect(vote).toContainText('Result: Failed · 2 present');
  await page.screenshot({ path: 'test-results/meeting-doc/board-vote.png' });
  await vote.getByRole('button', { name: 'Record vote' }).click();
  await expect(vote).toHaveCount(0);
  // + Motion and Approve last minutes.
  await panel.getByRole('button', { name: 'Motion' }).click();
  const md = page.getByTestId('motion-dialog');
  await md.getByRole('button', { name: 'Add motion' }).click();
  await expect(md).toContainText('Write the motion');
  await md.getByLabel('Motion').fill('Hire a treasurer');
  await md.getByLabel('Proposed by').selectOption({ label: 'Mia' });
  await md.getByLabel('Seconded by').selectOption({ label: 'Mia' });
  await md.getByRole('button', { name: 'Add motion' }).click();
  await expect(md).toContainText('Someone else seconds the motion');
  await md.getByLabel('Seconded by').selectOption({ label: 'Asha' });
  await md.getByRole('button', { name: 'Add motion' }).click();
  await expect(md).toHaveCount(0);
  await panel.getByRole('button', { name: 'Approve last minutes (Board · Dec 7)' }).click();
  await page.screenshot({ path: 'test-results/meeting-doc/board-panel.png' });
  const c = await calls(page);
  expect(c.filter((x: unknown[]) => x[0] !== 'present')).toEqual([
    ['vote', { docSlug: 'weekly-jan-7', motionId: 'm1', for: 0, against: 2, abstain: 0 }],
    ['motion', { docSlug: 'weekly-jan-7', text: 'Hire a treasurer', proposedBy: '33333333-3333-4333-8333-333333333333', secondedBy: '11111111-1111-4111-8111-111111111111' }],
    ['approve', { docSlug: 'weekly-jan-7' }],
  ]);
  expect(await axeViolations(page)).toEqual([]);
});

// Plan A4.16 (report 38.11 S8): New meeting follows Settings → Meetings.
test('S8: New meeting offers only the switched-on types, starts at the default length and says reminders are off', async ({ page }) => {
  await open(page, { view: 'new', settings: true });
  const d = page.getByTestId('new-meeting-dialog');
  await expect(d.getByRole('radiogroup', { name: 'Type' }).getByRole('radio')).toHaveCount(2);
  await expect(d.getByLabel('Length')).toHaveValue('45');
  await expect(d).toContainText('No reminders (Settings → Meetings).');
});

// Plan B7.3b (report 36.4 call 7): at a club's general meeting or AGM a motion may change one article.
test('B7.3b: a motion that adds an article to the constitution, with the two-thirds threshold', async ({ page }) => {
  await open(page, { board: true, amend: true });
  await page.getByTestId('board-panel').getByRole('button', { name: 'Motion', exact: true }).click();
  const d = page.getByTestId('motion-dialog');
  await d.getByLabel('Motion').fill('Add a Tech officer');
  await d.getByLabel(/Changes the constitution \(version 4; needs two-thirds of those voting\)/).check();
  await d.getByLabel('Article', { exact: true }).fill('6.4');
  await d.getByLabel('Title of the new article').fill('Tech officer');
  await d.getByLabel('New text').fill("A Tech officer looks after the club's tools.");
  expect(await axeViolations(page)).toEqual([]);
  await d.getByRole('button', { name: 'Add motion' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['motion', { docSlug: 'weekly-jan-7', text: 'Add a Tech officer', amendment: { article: '6.4', title: 'Tech officer', text: "A Tech officer looks after the club's tools." } }]);
});

