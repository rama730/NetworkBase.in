import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B2.3a (report 31.5 C5).
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const settings = { on: true, everyWeeks: 2, minutes: 30, checkins: 6, rhythmDays: 21, useful: true };
    (window as any).__actions = {
      readMentoringAction: async () => ({ success: true, on: true, canSet: true, settings,
        myMentor: { mentors: [{ id: 'm1', name: 'Arjun' }], plan: 'every 2 weeks · 30 min · 4 of 6', last: '2027-02-01', rhythm: { on: true, days: 5 } },
        mentees: [{ id: 'u2', name: 'K. Shah', last: '2027-01-02', held: 2, rhythm: { on: false, days: 24 } }],
        staff: { cards: [{ id: 'g1', name: 'Arjun’s group', mentors: [{ id: 'm1', name: 'Arjun' }], learners: 6, onRhythm: 5, objectives: { onTrack: 12, atRisk: 3 }, off: [{ name: 'K. Shah', days: 24 }], useful: { shown: true, answers: 21, useful: 18, line: 'Useful: 18 of 21' } },
          { id: 'g2', name: 'Priya’s group', mentors: [{ id: 'm2', name: 'Priya' }], learners: 2, onRhythm: 2, objectives: { onTrack: 0, atRisk: 0 }, off: [], useful: { shown: false, answers: 3 } }],
          unmatched: [{ id: 'u9', name: 'A. New' }], suggestions: [{ userId: 'u9', groupId: 'g2' }] } }),
      matchMentorsAction: async (_o: string, pairs: unknown) => { calls.push(['match', pairs]); return { success: true, matched: 1 }; },
      readCheckinsAction: async () => ({ success: true, learnerId: 'u1', isLearner: true, isMentor: false, usefulOn: true, today: '2027-02-10',
        entries: [{ id: 'c2', date: '2027-02-08', prep: { since: 'Shipped home', stuck: 'CSS grid', asks: '' }, prepDone: true, notes: 'Rewrite About', shared: false, answered: false }] }),
      saveCheckinAction: async (_o: string, l: string, input: unknown) => { calls.push(['save', l, input]); return { success: true, id: 'c3' }; },
      shareCheckinAction: async (_o: string, id: string, share: boolean) => { calls.push(['share', id, share]); return { success: true }; },
      answerUsefulAction: async (_o: string, id: string, a: string) => { calls.push(['useful', id, a]); return { success: true }; },
      saveMentoringSettingsAction: async (_o: string, s: unknown) => { calls.push(['settings', s]); return { success: true }; },
      readObjectivesAction: async () => ({ success: true, canAdd: true, objectives: [{ id: 'o1', title: 'Ship the portfolio', status: 'on_track' }] }),
      saveObjectiveAction: async (_o: string, _w: unknown, input: unknown) => { calls.push(['objective', input]); return { success: true }; },
      readMentorNoteAction: async () => ({ success: true, isLearner: true, note: { body: 'Shipped a real portfolio', approved: false, by: 'Arjun' } }),
      approveMentorNoteAction: async (_o: string, a: boolean) => { calls.push(['approve', a]); return { success: true }; },
      raiseConcernAction: async (_o: string, input: unknown) => { calls.push(['concern', input]); return { success: true }; },
      readBookingAction: async () => ({ success: true, next: null, minutes: 30, zone: 'UTC', mentors: [{ id: 'm1', name: 'Arjun', free: ['2027-02-17T18:00:00.000Z', '2027-02-24T18:00:00.000Z'] }] }),
      bookCheckinAction: async (_o: string, m: string, at: string) => { calls.push(['book', m, at]); return { success: true, startsAt: at, minutes: 30, mentor: 'Arjun', ics: 'BEGIN:VCALENDAR' }; },
      readMySlotsAction: async () => ({ success: true, zone: 'UTC', slots: [{ weekday: 3, start: '18:00' }] }),
      saveMySlotsAction: async (_o: string, rows: unknown) => { calls.push(['slots', rows]); return { success: true }; },
      readConcernsAction: async () => ({ success: true, concerns: [{ id: 'k1', body: 'Missed two check-ins', at: '2027-02-10T09:00:00Z', from: 'Arjun', about: 'K. Shah' }] }),
    };
  });
  await openApp(page, 'tests/browser/mentoring.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Mentors: cards with rhythm in words, Useful only from 5, and Match as suggested', async ({ page }) => {
  await open(page, 'mentors');
  const cards = page.getByTestId('mentor-card');
  await expect(cards.first()).toContainText('Arjun · 6 learners');
  await expect(cards.first()).toContainText('K. Shah');
  await expect(cards.first()).toContainText('No check-in in 24 days');
  await expect(cards.first()).toContainText('Useful: 18 of 21');
  await expect(cards.nth(1)).toContainText('Useful shows after 5 answers (3 so far)');
  await expect(page.getByLabel('Mentor group for A. New').locator('option', { hasText: 'Priya (suggested)' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Match as suggested' }).click();
  await expect.poll(() => calls(page)).toEqual([['match', [{ userId: 'u9', groupId: 'g2' }]]]);
  expect(await axeViolations(page)).toEqual([]);
});

test('My mentor and My mentees cards', async ({ page }) => {
  await open(page, 'card');
  await expect(page.getByTestId('my-mentor')).toContainText('Arjun');
  await expect(page.getByTestId('my-mentor')).toContainText('every 2 weeks · 30 min · 4 of 6');
  await expect(page.getByTestId('my-mentees')).toContainText(/K\. Shah\s*No check-in in 24 days/);
});

test('check-ins: Prep, notes, Share and Was this useful?', async ({ page }) => {
  await open(page, 'checkins');
  const entry = page.getByTestId('checkin-entry');
  await expect(entry).toContainText('Prep done');
  await entry.getByLabel('Asks').fill('Review my About page');
  await entry.getByRole('button', { name: 'Save prep' }).click();
  await entry.getByRole('button', { name: 'Share with the instructor' }).click();
  await entry.getByRole('button', { name: 'Very' }).click();
  await expect.poll(() => calls(page)).toEqual([
    ['save', 'u1', { date: '2027-02-08', prep: { since: 'Shipped home', stuck: 'CSS grid', asks: 'Review my About page' } }],
    ['share', 'c2', true], ['useful', 'c2', 'very']]);
  expect(await axeViolations(page)).toEqual([]);
});

test('Settings → Mentoring saves the plan', async ({ page }) => {
  await open(page, 'settings');
  await page.getByLabel('Every (weeks)').fill('1');
  await page.getByRole('button', { name: 'Save mentoring' }).click();
  await expect.poll(() => calls(page)).toEqual([['settings', { on: true, everyWeeks: 1, minutes: 30, checkins: 6, rhythmDays: 21, useful: true }]]);
});

test('B2.3b: Book a time lists free times as buttons and offers a .ics; a mentor saves their times; the Teacher reads concerns', async ({ page }) => {
  await open(page, 'card');
  const book = page.getByTestId('book-time');
  await book.getByRole('button', { name: /with Arjun/ }).first().click();
  await expect(book.getByRole('link', { name: 'Add to calendar (.ics)' })).toBeVisible();
  await page.getByText('Your times for booking (1)').click();
  await page.getByRole('button', { name: 'Add a time' }).click();
  await page.getByRole('button', { name: 'Save times' }).click();
  await expect.poll(() => calls(page)).toEqual([['book', 'm1', '2027-02-17T18:00:00.000Z'], ['slots', [{ weekday: 3, start: '18:00' }, { weekday: 3, start: '18:00' }]]]);
  await open(page, 'mentors');
  await expect(page.getByTestId('mentor-concerns')).toContainText('Arjun about K. Shah: Missed two check-ins');
});

test('B2.3b: in the pair dialog, objectives, the mentor’s note to approve, and a private concern', async ({ page }) => {
  await open(page, 'card');
  await page.getByRole('button', { name: 'Check-ins, Prep and objectives' }).click();
  const extras = page.getByTestId('pair-extras');
  await extras.getByLabel('Status of Ship the portfolio').selectOption('at_risk');
  await extras.getByLabel('New objective').fill('Pass Mock 5');
  await extras.getByRole('button', { name: 'Add' }).click();
  await extras.getByRole('button', { name: 'Approve it' }).click();
  await extras.getByLabel('Concern', { exact: true }).fill('Our times keep moving');
  await extras.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => calls(page)).toEqual([['objective', { id: 'o1', status: 'at_risk' }], ['objective', { title: 'Pass Mock 5' }], ['approve', true], ['concern', { aboutId: null, body: 'Our times keep moving' }]]);
  expect(await axeViolations(page)).toEqual([]);
});
