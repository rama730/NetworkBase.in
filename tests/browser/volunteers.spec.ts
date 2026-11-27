import { expect, test } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

test.use({ reducedMotion: 'reduce', timezoneId: 'UTC' });

// Plan B8.1a (report 37.3 layers 4–6, 14).
test('Volunteers: places as words, Full and Short, Check in in the window, my hours; Regulars, swaps, hours to confirm, Ask; coordinators see coverage and counts; Volunteer with us', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readVolunteersAction: async () => ({ success: true, on: true, coordinator: true, roles: [{ id: 'sorting', name: 'Sorting', line: '', training: false }, { id: 'delivery', name: 'Delivery', line: '', training: true }],
        agreement: { text: 'Be kind.', version: 1 }, agreed: true, trained: [], hours: { year: 42, shifts: 14, waiting: 2 },
        regular: [], availability: 'Saturdays 8–12', volunteers: [{ id: 'u3', name: 'Bob' }], swapsIn: [{ id: 'w1', shiftId: 's1', from: 'Cat' }], swapsOut: [],
        waitingHours: [{ id: 'h1', name: 'Ann', day: '2099-11-01', hours: 2, role: 'Sorting', note: 'Weekend drive' }],
        shifts: [
          { id: 's0', role: 'Kitchen', roleId: 'sorting', place: 'Hall', note: '', start: '2099-12-05T08:00:00.000Z', end: '2099-12-05T11:00:00.000Z', places: 5, going: 5, waitlisted: 0, mine: 'going', checkedIn: false, canCheckIn: true, short: false, needsTraining: false, started: false },
          { id: 's1', role: 'Sorting', roleId: 'sorting', place: 'Food bank', note: '', start: '2099-12-06T08:00:00.000Z', end: '2099-12-06T11:00:00.000Z', places: 8, going: 6, waitlisted: 0, mine: null, checkedIn: false, canCheckIn: false, short: true, needsTraining: false, started: false, series: 'a1b2c3d4-0000-4000-8000-000000000001' },
          { id: 's2', role: 'Delivery', roleId: 'delivery', place: 'Food bank', note: '', start: '2099-12-06T11:00:00.000Z', end: '2099-12-06T14:00:00.000Z', places: 6, going: 6, waitlisted: 2, mine: null, checkedIn: false, canCheckIn: false, short: false, needsTraining: true, started: false }],
        coverage: [{ id: 's1', role: 'Sorting', start: '2099-12-06T08:00:00.000Z', end: '2099-12-06T11:00:00.000Z', places: 8, going: 6 }],
        people: [{ id: 'u2', name: 'Ann', trained: [], attended: 3, missed: 1, availability: 'Weekday evenings', involvement: 'Occasional' }] }),
      setRegularAction: async (_o: string, series: string, on: boolean) => { calls.push(['regular', series, on]); return { success: true, placed: 4 }; },
      askSwapAction: async (_o: string, id: string, to: string) => { calls.push(['swap', id, to]); return { success: true }; },
      answerSwapAction: async (_o: string, id: string, ok: boolean) => { calls.push(['swap-answer', id, ok]); return { success: true }; },
      confirmHoursAction: async (_o: string, id: string, ok: boolean) => { calls.push(['hours', id, ok]); return { success: true }; },
      askForShiftAction: async (_o: string, id: string) => { calls.push(['ask', id]); return { success: true, asked: 3 }; },
      checkInShiftAction: async (_o: string, id: string, who: string | null) => { calls.push(['checkin', id, who]); return { success: true }; },
      shiftSignUpAction: async (_o: string, id: string, choice: string) => { calls.push(['signup', id, choice]); return { success: true, state: 'going' }; },
      signOffTrainingAction: async (_o: string, who: string, role: string, on: boolean) => { calls.push(['train', who, role, on]); return { success: true }; },
      readVolunteerWithUsAction: async () => ({ success: true, member: false, shifts: [{ id: 's1', role: 'Sorting', training: false, place: 'Food bank', start: '2099-12-06T08:00:00.000Z', end: '2099-12-06T11:00:00.000Z', places: 8, left: 2 }] }),
    };
  });
  await openApp(page, 'tests/browser/volunteers.fixture.tsx');
  const card = page.getByTestId('volunteers');
  await expect(card.getByTestId('volunteer-hours')).toContainText('My hours this year: 42 (14 shifts) · 2 waiting confirmation');
  const mine = card.getByTestId('volunteer-my-shift');
  await expect(mine).toContainText('Sat, 5 December 2099, 08:00–11:00 (UTC) · Kitchen · Hall');
  await mine.getByRole('button', { name: 'Check in' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['checkin', 's0', null]);
  const sorting = card.getByTestId('volunteer-shift').filter({ hasText: 'Sorting' });
  await expect(sorting).toContainText('6 of 8');
  await expect(sorting).toContainText('Short');
  await sorting.getByRole('button', { name: 'Sign up for Sorting' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['signup', 's1', 'going']);
  const delivery = card.getByTestId('volunteer-shift').filter({ hasText: 'Delivery' });
  await expect(delivery).toContainText('6 of 6 · waitlist 2');
  await expect(delivery).toContainText('Full');
  await expect(delivery).toContainText('Needs training');
  await expect(card.getByTestId('volunteer-coverage')).toContainText('Sorting · short 2');
  await card.getByText('People', { exact: true }).click();
  const ann = card.getByTestId('volunteer-person');
  await expect(ann).toContainText('Occasional · 3 attended · 1 missed · Weekday evenings');
  await ann.getByLabel('Delivery').check();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['train', 'u2', 'delivery', true]);
  // B8.1b: Regulars, swaps, hours waiting confirmation, Ask.
  await sorting.getByRole('button', { name: 'Be a Regular for Sorting' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['regular', 'a1b2c3d4-0000-4000-8000-000000000001', true]);
  await mine.getByLabel('Swap Kitchen with').selectOption({ label: 'Bob' });
  await mine.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['swap', 's0', 'u3']);
  await card.getByTestId('volunteer-swap-in').getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['swap-answer', 'w1', true]);
  await card.getByTestId('volunteer-waiting-hours').getByRole('button', { name: 'Confirm Ann’s hours' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['hours', 'h1', true]);
  await card.getByTestId('volunteer-coverage').getByRole('button', { name: 'Ask for Sorting' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['ask', 's1']);
  const pub = page.getByTestId('volunteer-with-us');
  await expect(pub).toContainText('2 of 8 places left · Training: none');
  await expect(pub).toContainText('Join with the button at the top to volunteer.');
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});
