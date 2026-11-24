import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.18 W2–W8 (plan A7.6–A7.7).
async function open(page: Page, view: string, opts: { manage?: boolean; width?: number } = {}) {
  await page.setViewportSize({ width: opts.width ?? 1000, height: 900 });
  await page.addInitScript((manage) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readPathAction: async () => ({ success: true, canManage: manage, insider: true, settings: { pacing: 'self', lockInOrder: true, public: false }, done: ['a'],
        upNext: { stepId: 's1', lessonId: 'b' },
        steps: [
          { id: 's1', name: 'Basics', position: 1, startDate: null, endDate: null, progress: { done: 1, total: 2 }, locked: false, assignments: [], lessons: [{ id: 'a', number: 410, title: 'Variables', minutes: 20 }, { id: 'b', number: 411, title: 'Loops', minutes: null }] },
          { id: 's2', name: 'Projects', position: 2, startDate: null, endDate: null, progress: { done: 0, total: 1 }, locked: true, assignments: [], lessons: [{ id: 'c', number: 412, title: 'Build a CLI', minutes: 45 }] },
        ] }),
      markLessonAction: async (_p: string, input: unknown) => { calls.push(['mark', input]); return { success: true }; },
      createStepAction: async (_p: string, input: unknown) => { calls.push(['step', input]); return { success: true, id: 's3' }; },
      addLessonAction: async (_p: string, input: unknown) => { calls.push(['lesson', input]); return { success: true, id: 'd', number: 413 }; },
      moveStepAction: async (_p: string, id: string, dir: string) => { calls.push(['move', id, dir]); return { success: true }; },
      setPathSettingsAction: async (_p: string, input: unknown) => { calls.push(['settings', input]); return { success: true }; },
      readProgressAction: async () => ({ success: true, steps: [{ id: 's1', name: 'Basics', total: 2 }, { id: 's2', name: 'Projects', total: 1 }],
        people: [{ id: 'u1', name: 'Asha', cells: [{ done: 2, total: 2 }, { done: 1, total: 1 }], lastActivity: '2026-11-24T10:00:00Z' }, { id: 'u2', name: 'Dev', cells: [{ done: 1, total: 2 }, { done: 0, total: 1 }], lastActivity: null }] }),
    };
  }, Boolean(opts.manage));
  await openApp(page, 'tests/browser/learning-path.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('W4/W5: steps with "1 of 2 done", Up next, a locked step says why; ticking is mine', async ({ page }) => {
  await open(page, 'path');
  const steps = page.getByTestId('path-step');
  await expect(steps.first()).toContainText(/1\s*Basics\s*1 of 2 done/);
  await expect(steps.first().getByTestId('path-lesson').nth(1)).toContainText(/Loops\s*Up next/);
  await expect(steps.nth(1)).toContainText('Finish Basics first');
  await expect(steps.nth(1).getByRole('checkbox', { name: 'Mark Build a CLI done' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Mark Loops done' }).click();
  expect(await calls(page)).toEqual([['mark', { taskId: 'b', done: true }]]);
  await expect(page.getByRole('button', { name: '+ Step' })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});

test('W1–W3: owners and admins pick pacing, add steps and lessons, and move steps', async ({ page }) => {
  await open(page, 'path', { manage: true });
  await page.getByRole('button', { name: '+ Step' }).click();
  await page.getByLabel('Step name').fill('Wrap-up');
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByTestId('path-step').first().getByRole('button', { name: '+ Lesson' }).click();
  await page.getByLabel('Lesson title').fill('Functions');
  await page.getByLabel('Minutes').fill('30');
  await page.getByRole('button', { name: 'Add lesson' }).click();
  await page.getByRole('button', { name: 'Move Projects up' }).click();
  await page.getByLabel('Scheduled').click();
  await expect.poll(() => calls(page)).toEqual([
    ['step', { name: 'Wrap-up' }], ['lesson', { stepId: 's1', title: 'Functions', fields: { minutes: 30 } }], ['move', 's2', 'up'], ['settings', { pacing: 'scheduled', public: false }],
  ]);
  await page.screenshot({ path: 'test-results/learning-path/path.png' });
  expect(await axeViolations(page)).toEqual([]);
});

test('W6/W8: Progress as plain counts with last activity; phone', async ({ page }) => {
  await open(page, 'progress', { width: 375 });
  const table = page.getByTestId('path-progress');
  await expect(table.getByRole('row').nth(1)).toContainText(/Asha\s*2\/2\s*1\/1\s*2026-11-24/);
  await expect(table.getByRole('row').nth(2)).toContainText(/Dev\s*1\/2\s*0\/1\s*—/);
  expect(await axeViolations(page)).toEqual([]);
});
