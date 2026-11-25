import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B2.5a (report 31.6 C4).
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readCapstoneAction: async () => ({ success: true, canEdit: true, me: 'u1', title: 'Team Kite', public: false, readyBlock: 'It’s Ready once every milestone, the Final one too, is done.',
        capstone: { problem: 'Buses are late', audience: 'riders', metrics: ['Predict within 2 min'], roles: { u2: 'Front-end' },
          showcase: { title: 'Bus delay predictor', line: 'Know before you wait', links: { demo: '', code: '', video: '' }, track: 'Data', readyAt: null, consents: { u1: '2027-01-01' } } },
        members: [{ id: 'u1', name: 'A. Rao' }, { id: 'u2', name: 'K. Shah' }], mentors: [{ id: 'm1', name: 'Arjun' }],
        milestones: [{ id: 't1', title: 'MVP', due: '2027-01-20', done: true }, { id: 't2', title: 'Final', due: '2027-02-05', done: false }], next: { id: 't2', title: 'Final', due: '2027-02-05', done: false } }),
      saveCapstoneAction: async (_p: string, input: unknown) => { calls.push(['save', input]); return { success: true }; },
      setShowcaseReadyAction: async (_p: string, ready: boolean) => { calls.push(['ready', ready]); return { success: false, error: 'It’s Ready once every milestone, the Final one too, is done.' }; },
      consentShowcaseAction: async (_p: string, agree: boolean) => { calls.push(['consent', agree]); return { success: true }; },
      readTeamFeedbackAction: async () => ({ success: true, feedback: [{ scores: { problem: 5, demo: 4 }, note: 'Great live demo' }] }),
      readShowcaseAction: async () => ({ success: true, tracks: ['Data', 'Health'], cards: [
        { id: 'w1', slug: 'kite', title: 'Bus delay predictor', line: 'Know before you wait', track: 'Data', links: { demo: 'https://example.com/demo', code: '', video: '' }, cover: null, team: ['A. Rao', 'K. Shah'] },
        { id: 'w2', slug: 'lumen', title: 'Clinic queue app', line: '', track: 'Health', links: { demo: '', code: '', video: '' }, cover: null, team: null }] }),
      readCapstoneTeamsAction: async () => ({ success: true, rows: [{ id: 'w1', slug: 'kite', title: 'Team Kite', size: 3, problem: 'Buses are late', mentors: ['Arjun'], next: { title: 'Final', due: '2027-02-05', overdue: true }, done: 1, total: 2, showcase: 'draft' }] }),
    };
  });
  await openApp(page, 'tests/browser/capstone.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('the team card: brief, roles, milestones in words, the Showcase card with Ready and the public agreement', async ({ page }) => {
  await open(page, 'card');
  const card = page.getByTestId('capstone-card');
  await expect(card).toContainText('Buses are late');
  await expect(card).toContainText('K. Shah — Front-end');
  await expect(card).toContainText('Mentor Arjun');
  await expect(card).toContainText(/MVP\s*Done/);
  await expect(card.getByTestId('team-feedback')).toContainText('Problem 5 · Demo 4 — Great live demo');
  await expect(card.getByTestId('showcase-card')).toContainText('Public only when every member agrees (1 of 2)');
  await card.getByRole('button', { name: 'Mark Ready' }).click();
  await expect(page.getByText('It’s Ready once every milestone, the Final one too, is done.').first()).toBeVisible();
  await card.getByLabel('I agree to show it publicly').click();
  await card.getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('capstone-edit').getByLabel('Track').fill('Mobility');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => calls(page)).toEqual([['ready', true], ['consent', false],
    ['save', { problem: 'Buses are late', audience: 'riders', metrics: ['Predict within 2 min'], showcase: { title: 'Bus delay predictor', line: 'Know before you wait', track: 'Mobility', links: { demo: '', code: '', video: '' } } }]]);
});

test('Showcase filters by track; the staff table shows milestones and Overdue in words', async ({ page }) => {
  await open(page, 'showcase');
  await expect(page.getByTestId('showcase-item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Health' }).click();
  await expect(page.getByTestId('showcase-item')).toHaveCount(1);
  expect(await axeViolations(page)).toEqual([]);
  await open(page, 'teams');
  await expect(page.getByTestId('capstone-row')).toContainText(/Team Kite\s*\(3\)\s*Buses are late\s*Arjun\s*1\/2\s*· Final Feb 5\s*Overdue\s*Draft/);
});
