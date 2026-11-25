import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B2.2a (report 31.3 C2): a self-paced class — the learner's header, Modules, Suggested pace, and staff Progress.
async function open(page: Page, view: string, manage = false, open2 = false) {
  await page.setViewportSize({ width: 1000, height: 900 });
  if (open2) await page.addInitScript(() => { (window as any).__open2 = true; });
  await page.addInitScript((m) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readPathAction: async () => ({ success: true, canManage: m, seesProgress: m, insider: true, isClass: true,
        settings: { pacing: 'self', lockInOrder: true, public: false, paceWeeks: 2, stuckDays: 14 }, done: ['a'],
        mine: m ? null : { done: 1, total: 3, percent: 33, started: '2027-01-11T09:00:00Z', pace: 'behind' },
        upNext: { stepId: 's1', lessonId: 'b' }, unplaced: m ? [{ id: 'h9', title: 'Capstone brief' }] : [],
        steps: [
          { id: 's1', name: 'Module 1 · Basics', position: 1, startDate: null, endDate: null, progress: { done: 1, total: 2 }, locked: false, assignments: [], lessons: [{ id: 'a', number: 410, title: 'Variables', minutes: 20 }, { id: 'b', number: 411, title: 'Loops', minutes: null }] },
          { id: 's2', name: 'Module 2 · Projects', position: 2, startDate: null, endDate: null, progress: { done: 0, total: 1 }, locked: !(window as any).__open2,
            assignments: [{ id: 'h1', title: 'Exercise 5', dueAfterDays: 7, published: true, copy: null }], lessons: [{ id: 'c', number: 412, title: 'Build a CLI', minutes: 45 }] },
        ] }),
      setPathSettingsAction: async (_p: string, input: unknown) => { calls.push(['settings', input]); return { success: true }; },
      openModuleAction: async (_p: string, step: string) => { calls.push(['open', step]); return { success: true, made: 1 }; },
      placeAssignmentAction: async (_p: string, input: unknown) => { calls.push(['place', input]); return { success: true }; },
      createStepAction: async (_p: string, input: unknown) => { calls.push(['step', input]); return { success: true, id: 's3' }; },
      readProgressAction: async () => ({ success: true, isClass: true, steps: [{ id: 's1', name: 'M1', total: 2 }, { id: 's2', name: 'M2', total: 1 }],
        dropOff: { reached: [4, 1], worst: 1, dropPercent: 75 },
        people: [
          { id: 'u1', name: 'A. Rao', cells: [{ done: 2, total: 2 }, { done: 1, total: 1 }], lastActivity: '2027-02-01T10:00:00Z', started: '2027-01-11T09:00:00Z', percent: 100, pace: 'on', stuck: null },
          { id: 'u2', name: 'K. Shah', cells: [{ done: 1, total: 2 }, { done: 0, total: 1 }], lastActivity: null, started: '2027-01-11T09:00:00Z', percent: 33, pace: 'behind', stuck: 18 },
        ] }),
    };
  }, manage);
  await openApp(page, 'tests/browser/learning-path.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('a learner sees their %, steps, start and pace in words, and Modules', async ({ page }) => {
  await open(page, 'path');
  const mine = page.getByTestId('path-mine');
  await expect(mine).toContainText('33% · 1 of 3 steps');
  await expect(mine).toContainText('Behind pace');
  await expect(mine).toContainText('started Jan 11');
  await expect(mine.getByRole('img', { name: '33%, 1 of 3 steps' })).toBeVisible();
  await expect(page.getByTestId('path-step').nth(1)).toContainText('Finish Module 1 · Basics first');
  expect(await axeViolations(page)).toEqual([]);
});

test('the Teacher sets Suggested pace and adds a Module', async ({ page }) => {
  await open(page, 'path', true);
  // Found live: in a class the Teacher builds the path; only learners tick, and Pacing lives in Settings.
  await expect(page.getByRole('checkbox', { name: 'Mark Loops done' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Scheduled' })).toHaveCount(0);
  await page.getByLabel('Suggested pace').selectOption('1');
  await page.getByRole('button', { name: '+ Module' }).click();
  await page.getByLabel('Module name').fill('Module 3 · Files');
  await page.getByRole('button', { name: 'Add module' }).click();
  await expect.poll(() => calls(page)).toEqual([['settings', { paceWeeks: 1 }], ['step', { name: 'Module 3 · Files' }]]);
});

test('Progress: learners with Started, %, pace and Stuck, and the drop-off line', async ({ page }) => {
  await open(page, 'progress', true);
  const table = page.getByTestId('path-progress');
  await expect(table.getByRole('columnheader', { name: 'Learner' })).toBeVisible();
  await expect(table.getByRole('row', { name: /K\. Shah/ })).toContainText(/Jan 11\s*1\/2\s*0\/1\s*33%\s*Behind\s*Stuck 18 days/);
  await expect(page.getByTestId('path-dropoff')).toContainText(/Reached\s*M1 4\s*· M2 1\s*−75%/);
  expect(await axeViolations(page)).toEqual([]);
});

test('B2.2b: a module\'s assignment says when it\'s due; Start opens the module; the Teacher puts an assignment in a module', async ({ page }) => {
  await open(page, 'path', false, true);
  const row = page.getByTestId('path-assignment');
  await expect(row).toContainText(/Exercise 5\s*Not started\s*due 7 days after you start/);
  await page.getByRole('button', { name: 'Start Module 2 · Projects' }).click();
  await expect.poll(() => calls(page)).toEqual([['open', 's2']]);
  await open(page, 'path', true);
  await page.getByLabel('Assignment to put in this module').first().selectOption('h9');
  await page.getByLabel('Due days after starting').fill('10');
  await page.getByRole('button', { name: 'Put in module' }).click();
  await expect.poll(() => calls(page)).toEqual([['place', { assignmentId: 'h9', stepId: 's1', dueAfterDays: 10 }]]);
  expect(await axeViolations(page)).toEqual([]);
});
