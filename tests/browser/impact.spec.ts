import { expect, test } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

test.use({ reducedMotion: 'reduce' });

// Plan B8.3a (report 37.5 layers 4, 6, 12, 14).
test('Programs: Ongoing or dates, the goal, measures as text with their source, typed numbers sent and confirmed', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readProgramsAction: async () => ({ success: true, admin: true, people: [{ id: 'u2', name: 'Asha' }],
        programs: [{ id: 'p1', title: 'Reading circles', slug: 'reading-circles', owner: 'Asha', canType: true, state: 'running', start: '2024-06-01', end: null, goal: "Children's literacy", aim: 'Children read weekly', public: true,
          measures: [{ id: 'sessions', name: 'Sessions held', source: 'sessions', target: 50, value: 46, waiting: false }, { id: 'hours', name: 'Volunteer hours', source: 'hours', target: null, value: 312, waiting: false },
            { id: 'reading', name: 'Children reading weekly', source: 'typed', target: 80, value: null, waiting: true }] },
          { id: 'p2', title: 'Digital skills', slug: null, owner: 'Dev', canType: false, state: 'planned', start: '2027-02-01', end: '2027-06-30', goal: '', aim: '', public: false, measures: [] }],
        waiting: [{ id: 'n1', program: 'Reading circles', measure: 'Children reading weekly', value: 64, note: '', by: 'Asha', at: '2026-11-27T10:00:00.000Z' }] }),
      typeNumberAction: async (_o: string, p: string, m: string, v: number) => { calls.push(['type', p, m, v]); return { success: true }; },
      confirmNumberAction: async (_o: string, id: string, ok: boolean) => { calls.push(['confirm', id, ok]); return { success: true }; },
    };
  });
  await openApp(page, 'tests/browser/impact.fixture.tsx');
  const card = page.getByTestId('programs');
  const reading = card.getByTestId('program').filter({ hasText: 'Reading circles' });
  await expect(reading).toContainText('Ongoing since 1 June 2024 · Owner Asha · Children read weekly');
  const measures = reading.getByTestId('program-measure');
  await expect(measures.nth(0)).toContainText('Sessions held: 46 of 50 (Sessions held)');
  await expect(measures.nth(1)).toContainText('Volunteer hours: 312 (Volunteer hours)');
  await expect(measures.nth(2)).toContainText('Children reading weekly: not yet confirmed (Typed number · a number is waiting confirmation)');
  await measures.nth(2).getByLabel('New number for Children reading weekly').fill('70');
  await measures.nth(2).getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['type', 'p1', 'reading', 70]);
  await expect(card.getByTestId('program').filter({ hasText: 'Digital skills' })).toContainText('1 February 2027 to 30 June 2027');
  await expect(card.getByTestId('program').filter({ hasText: 'Digital skills' })).toContainText('Not linked');
  await card.getByTestId('program-waiting').getByRole('button', { name: 'Confirm Children reading weekly for Reading circles' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['confirm', 'n1', true]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

// Plan B8.3b (report 37.5 call 9, layer 14): consent shown as words; Publish waits for everyone's yes.
test('Stories: consent as words, Give my yes, Record consent for someone outside, Publish waits until everyone agrees', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readProgramsAction: async () => ({ success: true, admin: false, people: [], waiting: [],
        programs: [{ id: 'p1', title: 'Winter food drive', slug: 'winter', owner: 'Asha', canType: true, state: 'running', start: '2026-12-01', end: '2027-01-31', goal: 'Food security', aim: '', public: true, measures: [] }] }),
      readStoriesAction: async () => ({ success: true, canEdit: true, me: 'u3', stories: [{ id: 's1', headline: 'A warm kitchen', body: 'Forty families ate together.', state: 'draft',
        people: [{ name: 'Ravi', member: true, mine: true, consent: null }, { name: 'Mrs Rao', member: false, mine: false, consent: null }] }] }),
      setStoryConsentAction: async (_o: string, id: string, i: number, input: unknown) => { calls.push(['consent', id, i, input]); return { success: true }; },
    };
  });
  await openApp(page, 'tests/browser/impact.fixture.tsx');
  await page.getByRole('button', { name: 'Stories of Winter food drive' }).click();
  const story = page.getByTestId('program-story');
  const people = story.getByTestId('program-story-person');
  await expect(people.nth(0)).toContainText('Ravi: no consent yet');
  await expect(story.getByRole('button', { name: 'Publish (waiting for consent)' })).toBeDisabled();
  await people.nth(0).getByRole('button', { name: 'Give my yes' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['consent', 's1', 0, { give: true }]);
  await people.nth(1).getByLabel('Who gave consent for Mrs Rao').fill('Mrs Rao');
  await people.nth(1).getByLabel('When Mrs Rao gave consent').fill('2026-11-20');
  await people.nth(1).getByRole('button', { name: 'Record consent' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['consent', 's1', 1, { give: true, by: 'Mrs Rao', at: '2026-11-20' }]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});
