import { expect, test } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

test.use({ reducedMotion: 'reduce' });

// Plan B8.2a (report 37.4 layers 3, 5, 6, 14).
test('Dates: the countdown with the key date in full, this week worked back (offsets as words), Move with a preview of what moves and what stays', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readFixedTimeAction: async () => ({ success: true, organiser: true, member: true, starters: [{ id: 'event', name: 'Event', tasks: 14 }], people: [], workstreams: [], bookings: [], issues: [],
        fixed: { keyDate: '2027-02-13', endDate: '2027-03-15', starter: 'event', state: 'planning', line: '23 days to go', moves: [] },
        week: [{ id: 't1', title: 'Confirm stalls', due: '2027-01-23', phase: 'Book', offset: '21 days before', handSet: false, overdue: false },
          { id: 't2', title: 'Volunteer briefing', due: '2027-01-24', phase: 'Final week', offset: '14 days before', handSet: true, overdue: false }] }),
      previewMoveAction: async (_o: string, to: string) => { calls.push(['preview', to]); return { success: true, passed: false,
        moves: [{ id: 't1', title: 'Confirm stalls', from: '2027-01-23', to: '2027-01-30' }], stays: [{ id: 't2', title: 'Volunteer briefing', due: '2027-01-24' }] }; },
      moveKeyDateAction: async (_o: string, to: string, reason: string | null) => { calls.push(['move', to, reason]); return { success: true, moved: 1 }; },
    };
  });
  await openApp(page, 'tests/browser/fixed-time.fixture.tsx');
  const card = page.getByTestId('fixed-time');
  await expect(card.getByTestId('fixed-time-countdown')).toContainText('23 days to go · Sat, 13 February 2027 · ends Mon, 15 March 2027');
  await expect(card).toContainText('Planning');
  const tasks = card.getByTestId('fixed-time-task');
  await expect(tasks.nth(0)).toContainText('Confirm stalls · Sat, 23 January 2027 · 21 days before');
  await expect(tasks.nth(1)).toContainText('Volunteer briefing · Sun, 24 January 2027 · set by hand');
  await card.getByRole('button', { name: 'Move the key date' }).click();
  const move = card.getByTestId('fixed-time-move');
  await move.getByLabel('New key date').fill('2027-02-20');
  await move.getByRole('button', { name: 'Preview' }).click();
  await expect(move).toContainText('1 date moves; 1 set by hand stays.');
  await expect(move).toContainText('Volunteer briefing: stays Sun, 24 January 2027 (set by hand)');
  expect(await axeViolations(page)).toEqual([]);
  await move.getByRole('button', { name: 'Move it' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['move', '2027-02-20', null]);
});

// Plan B8.2b (report 37.4 calls 2–3, layer 6).
test('Day of: workstreams with owners, bookings with states as words and typed references, Issues today', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readFixedTimeAction: async () => ({ success: true, organiser: true, member: true, starters: [], people: [{ id: 'u2', name: 'Asha' }],
        fixed: { keyDate: '2027-02-13', endDate: '2027-03-15', starter: 'event', state: 'today', line: 'Today', moves: [] }, week: [],
        workstreams: [{ id: 'venue', name: 'Venue', owner: 'u2', ownerName: 'Asha' }, { id: 'comms', name: 'Comms', owner: null, ownerName: null }],
        bookings: [{ id: 'b1', title: 'Venue', supplier: 'MG Hall', ref: 'MG-2231', state: 'confirmed', workstream: 'venue', due: '2027-01-30', owner: 'Asha' },
          { id: 'b2', title: 'Permit', supplier: 'City office', ref: '', state: 'applied', workstream: null, due: '2027-01-30', owner: 'Dev' }],
        issues: [{ id: 'i1', title: 'Stage lights flicker', done: false, by: 'Mei' }] }),
      updateBookingAction: async (_o: string, id: string, input: unknown) => { calls.push(['booking', id, input]); return { success: true }; },
      raiseIssueAction: async (_o: string, title: string) => { calls.push(['issue', title]); return { success: true }; },
      solveIssueAction: async (_o: string, id: string, done: boolean) => { calls.push(['solve', id, done]); return { success: true }; },
    };
  });
  await openApp(page, 'tests/browser/fixed-time.fixture.tsx');
  const card = page.getByTestId('fixed-time');
  await expect(card.getByTestId('fixed-time-countdown')).toContainText('Today');
  await expect(card.getByTestId('fixed-time-workstreams')).toContainText('Venue (Asha) · Comms');
  const permit = card.getByTestId('fixed-time-booking').filter({ hasText: 'Permit' });
  await expect(permit.getByLabel('State of Permit')).toHaveValue('applied');
  await permit.getByLabel('Reference for Permit').fill('PR-88');
  await permit.getByRole('button', { name: 'Save the reference for Permit' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['booking', 'b2', { supplier: 'City office', ref: 'PR-88', state: 'applied', workstream: null }]);
  const day = card.getByTestId('fixed-time-day-of');
  await expect(day).toContainText('Stage lights flicker · Mei');
  await day.getByLabel('Add an issue').fill('Lost keys');
  await day.getByRole('button', { name: 'Add' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['issue', 'Lost keys']);
  await day.getByText('Stage lights flicker').click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['solve', 'i1', true]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});
