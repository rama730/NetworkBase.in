import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.11 D1 W1, W3, W5, W8, W9 (plan A4.1).
async function open(page: Page, opts: { view?: string; now?: string; finished?: boolean; series?: boolean } = {}) {
  await page.clock.setFixedTime(new Date(opts.now ?? '2027-01-07T04:40:00Z'));
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(({ finished, series }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readMeetingAction: async () => ({ success: true, canEdit: true, member: true, type: 'blank', title: 'Weekly · Jan 7', startsAt: '2027-01-07T04:30:00.000Z', lengthMinutes: 30,
        timeZone: 'Asia/Kolkata', attendees: [{ id: 'u2', name: 'Dev', avatarUrl: null }], seriesRule: series ? 'weekly' : null, seriesTitle: series ? 'Weekly' : null, seriesId: series ? 's1' : null,
        finishedAt: finished ? '2027-01-07T05:00:00.000Z' : null, openActionItems: 0 }),
      readMeetingsAction: async () => ({ success: true, projectKey: 'AC', timeZone: 'Asia/Kolkata', viewerId: 'u1', meetings: [], people: [{ id: 'u1', name: 'Asha' }, { id: 'u2', name: 'Dev' }],
        openActionItems: [{ id: 't1', number: 5, title: 'Fix the login typo', status: 'todo', dueDate: '2027-01-10', assigneeId: 'u2', assigneeName: 'Dev', meeting: { slug: 'weekly-jan-7', title: 'Weekly · Jan 7' } }] }),
      finishMeetingAction: async (_p: string, input: unknown) => { calls.push(['finish', input]); return { success: true, alreadyFinished: false, next: null }; },
      moveMeetingAction: async (_p: string, input: unknown) => { calls.push(['move', input]); return { success: true }; },
      readDocRowsAction: async () => ({ success: true, hidden: 0, canAdd: true, canSeeTasks: true, projectKey: 'AC', member: true, canPlanSprints: true,
        rows: [{ id: 'a', number: 1, title: 'One', status: 'todo', reviewStatus: 'none', dueDate: null, completedAt: null, position: 1, itemType: 'task', assignee: null, canTick: true },
          { id: 'b', number: 2, title: 'Two', status: 'in_progress', reviewStatus: 'none', dueDate: null, completedAt: null, position: 2, itemType: 'task', assignee: null, canTick: true },
          { id: 'c', number: 3, title: 'Three', status: 'done', reviewStatus: 'none', dueDate: null, completedAt: null, position: 3, itemType: 'task', assignee: null, canTick: true }] }),
      endSeriesAction: async (_p: string, input: unknown) => { calls.push(['end', input]); return { success: true }; },
    };
  }, { finished: opts.finished ?? false, series: opts.series ?? false });
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
  await expect(d.getByLabel('Title')).toHaveAttribute('placeholder', 'Meeting · Jan 7');
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
