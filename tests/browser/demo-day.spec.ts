import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B2.5b (report 31.6 C4).
async function open(page: Page, role: 'staff' | 'judge') {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.addInitScript((r) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const staff = r === 'staff';
    (window as any).__actions = {
      readDemoDayAction: async () => ({ success: true, staff, isJudge: !staff, date: '2027-02-12', start: '15:00', place: 'Hall B', link: '', current: 0, awards: ['Best project', 'Mentors’ pick'],
        show: [{ id: 't1', title: 'Team Lumen', at: '15:10' }, { id: 't2', title: 'Team Kite', at: '15:18' }], announced: [{ award: 'Best project', team: 'Team Kite' }],
        judging: staff ? null : { teams: [{ id: 't1', title: 'Team Lumen', own: false, scores: {}, note: '' }, { id: 't2', title: 'Team Kite', own: true, scores: {}, note: '' }], picks: {} },
        setup: staff ? { judges: ['j1'], people: [{ id: 'j1', name: 'Dr. Iyer' }, { id: 'm1', name: 'Arjun' }], pitch: 5, questions: 3,
          picks: [{ award: 'Best project', picks: [{ teamId: 't2', n: 2, team: 'Team Kite' }] }, { award: 'Mentors’ pick', picks: [] }] } : null }),
      advanceRunAction: async () => { calls.push(['next']); return { success: true, current: 1 }; },
      saveDemoDayAction: async (_c: string, input: unknown) => { calls.push(['setup', input]); return { success: true }; },
      announceAwardAction: async (_c: string, a: string, t: string) => { calls.push(['announce', a, t]); return { success: true }; },
      saveFeedbackAction: async (_c: string, t: string, input: unknown) => { calls.push(['feedback', t, input]); return { success: true }; },
      pickAwardAction: async (_c: string, a: string, t: string | null) => { calls.push(['pick', a, t]); return { success: true }; },
    };
  }, role);
  await openApp(page, 'tests/browser/demo-day.fixture.tsx', { path: '/' });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('staff: the run of show with Now, Next team, judges, and announcing a pick', async ({ page }) => {
  await open(page, 'staff');
  const card = page.getByTestId('demo-day');
  await expect(card.getByRole('list', { name: 'Run of show' })).toContainText(/15:10\s*Team Lumen\s*Now\s*15:18\s*Team Kite/);
  await expect(card.getByTestId('awards')).toContainText('Best project: Team Kite');
  await card.getByRole('button', { name: 'Next team' }).click();
  await card.getByText('Set up demo day').click();
  await card.getByLabel('Arjun').check();
  await card.getByRole('button', { name: 'Save demo day' }).click();
  await card.getByRole('button', { name: 'Announce Team Kite (2 picks)' }).click();
  const c = await calls(page);
  expect(c[0]).toEqual(['next']);
  expect(c[1][1]).toMatchObject({ date: '2027-02-12', place: 'Hall B', judges: ['j1', 'm1'], awards: ['Best project', 'Mentors’ pick'] });
  expect(c[2]).toEqual(['announce', 'Best project', 't2']);
  expect(await axeViolations(page)).toEqual([]);
});

test('a judge gives feedback (never a mark) and picks; their mentees’ team is left out', async ({ page }) => {
  await open(page, 'judge');
  await page.getByRole('button', { name: 'Judge the teams' }).click();
  const j = page.getByTestId('judging');
  await expect(j).toContainText('Team Kite');
  await expect(j).toContainText('Your mentees’ team');
  await expect(j.getByLabel('Demo for Team Kite')).toHaveCount(0);
  await j.getByLabel('Demo for Team Lumen').selectOption('4');
  await j.getByLabel('Note to Team Lumen').fill('Tighten the demo');
  await j.getByRole('button', { name: 'Save feedback' }).click();
  await j.getByLabel('Your pick for Best project').selectOption('t1');
  await expect.poll(() => calls(page)).toEqual([['feedback', 't1', { scores: { demo: 4 }, note: 'Tighten the demo' }], ['pick', 'Best project', 't1']]);
  await expect(j.getByLabel('Your pick for Best project').locator('option', { hasText: 'Team Kite' })).toHaveCount(0);
});
