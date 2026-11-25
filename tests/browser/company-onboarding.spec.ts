import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B4.4 (report 33.5).
const step = (stepId: string, title: string, extra: Record<string, unknown>) => ({ stepId, taskId: `t-${stepId}`, title, who: 'person', kind: 'do', day: 0, phase: 'Day 1', due: '2026-12-01', done: false, required: true, mine: true, ...extra });
const steps = [
  step('read', 'Read the Handbook: Overview', { kind: 'read', done: true }),
  step('meet', 'First check-in with Mei', { who: 'manager', kind: 'meet', mine: false }),
  step('tz', 'Add your time zone and working hours', { day: 3, phase: 'Week 1', due: '2026-12-04' }),
  step('hows', 'How’s it going?', { kind: 'answer', day: 30, phase: 'Month 2', due: '2026-12-31' }),
];
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript((steps) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readStartHereAction: async () => ({ success: true, onboarding: { start: '2026-12-01', day: 'Day 3', done: 1, total: 4, steps, complete: false, note: 'Welcome to Acme!', buddy: { id: 'arjun', name: 'Arjun' }, manager: 'Leo', answered: false } }),
      updateTaskStatusAction: async (id: string, status: string) => { calls.push(['tick', id, status]); return { success: true }; },
      answerHowsItGoingAction: async (_o: string, a: string) => { calls.push(['answer', a]); return { success: true }; },
      readOnboardingBoardAction: async () => ({ success: true, admin: true, me: 'leo', staff: [{ id: 'arjun', name: 'Arjun' }, { id: 'mei', name: 'Mei Lin' }],
        people: [{ userId: 'mei', name: 'Mei Lin', start: '2026-12-01', buddy: null, pct: 33, overdue: 1, complete: false, steps, answer: 'Going well' }] }),
      setBuddyAction: async (_o: string, u: string, b: string) => { calls.push(['buddy', u, b]); return { success: true }; },
      setOnboardingStartAction: async () => ({ success: true }),
      readOnboardingPlanAction: async () => ({ success: true, on: false, plan: [{ id: 'read-handbook', day: 0, who: 'person', kind: 'read', title: 'Read the Handbook: Overview', required: true }] }),
      saveOnboardingPlanAction: async (_o: string, v: unknown) => { calls.push(['plan', v]); return { success: true }; },
    };
  }, steps);
  await openApp(page, 'tests/browser/company-onboarding.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Start here: Day N and %, welcome note, buddy with Message, phases; tick a step; answer How’s it going?', async ({ page }) => {
  await open(page, 'start');
  const s = page.getByTestId('start-here');
  await expect(s).toContainText('Start here · Day 3');
  await expect(s).toContainText('1 of 4 steps · 25%');
  await expect(s).toContainText('Welcome to Acme!');
  await expect(s.getByRole('link', { name: 'Message' })).toHaveAttribute('href', '/messages?userId=arjun');
  await expect(s.getByRole('listitem').filter({ hasText: 'First check-in with Mei' })).toContainText('· Line manager');
  await s.getByLabel('Done: Add your time zone and working hours').check();
  await expect.poll(async () => (await calls(page))[0]).toEqual(['tick', 't-tz', 'done']);
  await s.getByLabel('How’s it going?').fill('Good so far');
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
  await s.getByRole('button', { name: 'Send' }).click();
  await expect.poll(async () => (await calls(page)).find((c: unknown[]) => c[0] === 'answer')).toEqual(['answer', 'Good so far']);
});

test('Onboarding board: % and overdue, pick a buddy; Settings → Onboarding plan switches on for people who join from now', async ({ page }) => {
  await open(page, 'board');
  const b = page.getByTestId('onboarding-board');
  await expect(b).toContainText('33%');
  await expect(b).toContainText('1 overdue');
  await expect(b).toContainText('How’s it going? Going well');
  await b.getByLabel('Mei Lin’s buddy').selectOption({ label: 'Arjun' });
  await expect.poll(async () => (await calls(page))[0]).toEqual(['buddy', 'mei', 'arjun']);
  expect(await axeViolations(page)).toEqual([]);
  await open(page, 'plan');
  const p = page.getByTestId('onboarding-plan');
  await p.getByLabel('Onboard people who join from now on').check();
  await p.getByRole('button', { name: 'Save the plan' }).click();
  await expect.poll(async () => ((await calls(page))[0]?.[1] as { on: boolean })?.on).toBe(true);
});
