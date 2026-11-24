import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 30.3 W2 (plan B1.2a).
const lesson = (id: string, title: string, stage: string, extra: Record<string, unknown> = {}) => ({ id, number: 1, title, stage, weekId: 'w2', order: 0, outcomes: [], createdAt: '2027-01-01T00:00:00Z',
  session: { key: '2027-01-19T10:30', start: '2027-01-19T10:30', end: '2027-01-19T12:00', status: 'on' }, needsNewSession: false, before: null, during: null, after: null, ...extra });
async function open(page: Page, view: string, role = 'teacher') {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript((r) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const staff = r !== 'student';
    (window as any).__actions = {
      readTermPlanAction: async () => ({ success: true, role: r, canWrite: true, settings: { outcomes: [{ code: 'CO1', text: 'Arrays' }, { code: 'CO2', text: 'Trees' }], studentsSee: 'ready', topicsLabel: 'Topics' },
        term: { start: '2027-01-11', end: '2027-04-25' }, week: { current: 2, total: 16, weekId: 'w2' }, breaks: [{ name: 'Mid-term break', start: '2027-01-25', end: '2027-01-29' }],
        coverage: { covered: 1, total: 2, missing: [{ code: 'CO2', text: 'Trees' }] },
        units: [{ id: 'u1', name: 'Unit 1 · Arrays', start: '2027-01-11T00:00:00Z', end: '2027-02-07T00:00:00Z', status: 'active', progress: { taught: 1, planned: 2, percent: 50 }, outcomes: ['CO1'],
          weeks: [
            { id: 'w1', unitId: 'u1', name: 'Week 1', goal: 'Arrays, complexity', start: '2027-01-11T00:00:00Z', end: '2027-01-17T00:00:00Z', status: 'completed', sessions: 2,
              assessments: [{ id: 'a1', title: 'Lab 1', due: '2027-01-15T18:00:00Z' }], lessons: [{ ...(window as any).__l1 }] },
            { id: 'w2', unitId: 'u1', name: 'Week 2', goal: null, start: '2027-01-18T00:00:00Z', end: '2027-01-24T00:00:00Z', status: 'active', sessions: 1, assessments: [],
              lessons: staff ? [{ ...(window as any).__l2 }, { ...(window as any).__l3 }] : [] },
          ] }],
        unplaced: [] }),
      addTermLessonAction: async (_o: string, input: unknown) => { calls.push(['add', input]); return { success: true, id: 'n' }; },
      setLessonStageAction: async (_o: string, id: string, stage: string) => { calls.push(['stage', id, stage]); return { success: true }; },
      setWeekTopicsAction: async (_o: string, id: string, t: string) => { calls.push(['topics', id, t]); return { success: true }; },
      updateLessonAction: async (_o: string, id: string, p: unknown) => { calls.push(['update', id, p]); return { success: true }; },
      saveLessonNotesAction: async (_o: string, id: string, n: string) => { calls.push(['notes', id, n]); return { success: true }; },
      saveTermPlanSettingsAction: async (_o: string, s: unknown) => { calls.push(['settings', s]); return { success: true }; },
    };
  }, role);
  await page.addInitScript((ls) => { Object.assign(window as any, ls); }, {
    __l1: lesson('l1', 'Arrays intro', 'taught', { weekId: 'w1', outcomes: ['CO1'] }),
    __l2: lesson('l2', 'Linked lists', 'draft', { notes: 'Bring the slides' }),
    __l3: lesson('l3', 'Stacks', 'ready', { needsNewSession: true, session: null }),
  });
  await openApp(page, 'tests/browser/term-plan.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('the table: header strip, unit progress in words, weeks with Topics and Assessments, the break row, missing outcomes', async ({ page }) => {
  await open(page, 'plan');
  await expect(page.getByTestId('term-plan-header')).toContainText('Week 2 of 16 · Outcomes covered 1 of 2');
  await expect(page.getByTestId('term-unit')).toContainText('50%, 1 of 2 taught');
  await expect(page.getByTestId('term-week').first()).toContainText('Lab 1 · due Jan 15');
  await expect(page.getByTestId('term-week').nth(1)).toContainText('Now');
  await expect(page.getByTestId('term-week').nth(1)).toContainText('0 of 2 taught');
  await expect(page.getByTestId('term-week').nth(1)).toContainText('2 lessons, 1 sessions');
  await expect(page.getByTestId('term-break')).toContainText('Mid-term break');
  await expect(page.getByTestId('term-plan-missing')).toContainText('CO2 · not covered by any lesson yet');
  await expect(page.getByTestId('term-lesson').filter({ hasText: 'Stacks' })).toContainText('Needs a new session');
  expect(await axeViolations(page)).toEqual([]);
});

test('the teacher adds a lesson, makes one Ready, edits Topics and keeps teacher notes', async ({ page }) => {
  await open(page, 'plan');
  await page.getByRole('button', { name: '+ Lesson in Week 2' }).click();
  await page.getByLabel('New lesson in Week 2').fill('Queues');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Ready Linked lists' }).click();
  await page.getByLabel('Topics for Week 2').fill('Lists');
  await page.getByLabel('Topics for Week 2').blur();
  await page.getByRole('button', { name: 'Linked lists', exact: true }).click();
  await expect(page.getByText('Only Teachers and TAs see this.')).toBeVisible();
  await expect.poll(() => calls(page)).toEqual([['add', { weekId: 'w2', title: 'Queues' }], ['stage', 'l2', 'ready'], ['topics', 'w2', 'Lists']]);
});

test('a TA only marks taught; a student sees Ready and Taught lessons without notes or buttons', async ({ page }) => {
  await open(page, 'plan', 'ta');
  await expect(page.getByRole('button', { name: '+ Lesson in Week 2' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ready Linked lists' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark taught Stacks' }).click();
  await expect.poll(() => calls(page)).toEqual([['stage', 'l3', 'taught']]);
});

test('a student: no add, no stage buttons, no teacher notes', async ({ page }) => {
  await open(page, 'plan', 'student');
  await expect(page.getByRole('button', { name: /Mark taught|Ready|\+ Lesson/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Arrays intro' }).click();
  await expect(page.getByText('Teacher notes')).toHaveCount(0);
});

test('Settings → Term plan: add an outcome and save', async ({ page }) => {
  await open(page, 'settings');
  await page.getByRole('button', { name: 'Add an outcome' }).click();
  await page.getByLabel('Outcome 3', { exact: true }).fill('Graphs');
  await page.getByRole('button', { name: 'Save term plan settings' }).click();
  await expect.poll(() => calls(page)).toEqual([['settings', { outcomes: [{ code: 'CO1', text: 'Arrays' }, { code: 'CO2', text: 'Trees' }, { code: 'CO3', text: 'Graphs' }], studentsSee: 'ready', topicsLabel: 'Topics' }]]);
  expect(await axeViolations(page)).toEqual([]);
});
