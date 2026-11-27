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
      readFixedTimeAction: async () => ({ success: true, organiser: true, starters: [{ id: 'event', name: 'Event', tasks: 14 }],
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
