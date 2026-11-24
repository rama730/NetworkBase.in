import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 30.8 W7 (plan B1.5a).
const LEVELS = [{ label: 'Excellent', points: 10, text: '' }, { label: 'Good', points: 7, text: '' }, { label: 'Fair', points: 4, text: '' }, { label: 'Missing', points: 0, text: '' }];
const RUBRIC = { id: 'r1', name: 'Lab rubric', criteria: [{ id: 'c1', name: 'Correctness', levels: LEVELS }, { id: 'c2', name: 'Report', levels: LEVELS }] };
async function open(page: Page, view: string, team = false, second = false) {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.addInitScript((s) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readMarkingAction: async () => s.second
        ? { success: true, marking: { mode: 'outof', outOf: 50 }, mark: { total: 30, outOf: 50, levels: {}, comment: null, marker: 'Dr Rao', markedAt: '', visible: false, adjustments: {}, second: { total: 40, marker: 'Mr Iyer', agreed: false } }, excused: false, commentBank: [], progress: { marked: 1, total: 1 }, team: [], secondRole: 'second' }
        : s.team
        ? { success: true, marking: { mode: 'outof', outOf: 50 }, mark: { total: 40, outOf: 50, levels: {}, comment: null, marker: 'Dr Rao', markedAt: '', visible: false, adjustments: { u2: { total: 30, reason: 'Missed two sessions' } } }, excused: false, commentBank: [], progress: { marked: 1, total: 2 }, team: [{ id: 'u1', name: 'A. Rao' }, { id: 'u2', name: 'K. Shah' }] }
        : { success: true, marking: { mode: 'rubric', rubric: s.rubric }, mark: null, excused: false, commentBank: ['Show your working'], progress: { marked: 24, total: 60 }, team: [] },
      saveSecondMarkAction: async (_c: string, n: number) => { calls.push(['second', n]); return { success: true, needsAgreement: true }; },
      agreeMarkAction: async (_c: string, n: number) => { calls.push(['agree', n]); return { success: true }; },
      adjustMarkAction: async (_c: string, who: string, total: number | null, why: string) => { calls.push(['adjust', who, total, why]); return { success: true }; },
      saveMarkAction: async (_c: string, d: { levels: Record<string, number> }) => {
        calls.push(['mark', d]);
        return Object.keys(d.levels).length < 2 ? { success: false, error: 'Pick a level for Report.' } : { success: true, total: 17, outOf: 20 };
      },
      readMyMarkAction: async () => ({ success: true, marking: { mode: 'rubric', rubric: s.rubric }, mark: { total: 17, outOf: 20, levels: { c1: 0, c2: 1 }, comment: 'Explain the edge case', marker: 'Dr Rao', markedAt: '', visible: true } }),
      readMarkingSettingsAction: async () => ({ success: true, teacher: true, rubrics: [s.rubric], commentBank: [], suggested: ['Cite your sources'] }),
      saveRubricAction: async (_o: string, r: unknown) => { calls.push(['rubric', r]); return { success: true, id: 'r2' }; },
      archiveRubricAction: async () => ({ success: true }),
      saveCommentBankAction: async (_o: string, l: string[]) => { calls.push(['bank', l]); return { success: true }; },
    };
  }, { rubric: RUBRIC, team, second });
  await openApp(page, 'tests/browser/marking.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('the panel: a radio group per criterion, keys pick levels, the live total, Hidden until you approve', async ({ page }) => {
  await open(page, 'panel');
  const correctness = page.getByRole('radiogroup', { name: 'Correctness' });
  await correctness.getByRole('radio', { name: /Excellent/ }).click();
  await expect(page.getByTestId('marking-total')).toContainText('Total 10 / 20');
  await page.getByRole('radiogroup', { name: 'Report' }).getByRole('radio', { name: /Fair/ }).focus();
  await page.keyboard.press('2');
  await expect(page.getByTestId('marking-total')).toContainText('Total 17 / 20 · 85% · saved');
  await expect(page.getByTestId('marking-panel')).toContainText('Hidden until you approve · Marked 24 of 60');
  await page.getByRole('button', { name: 'Show your working' }).click();
  expect((await calls(page)).at(-1)).toEqual(['mark', { levels: { c1: 0, c2: 1 }, comment: 'Show your working' }]);
  expect(await axeViolations(page)).toEqual([]);
});

test("the student's mark: total, levels and comment", async ({ page }) => {
  await open(page, 'mine');
  await expect(page.getByTestId('my-mark')).toContainText('17 / 20 · 85%');
  await expect(page.getByTestId('my-mark')).toContainText('Correctness Excellent · Report Good');
  await expect(page.getByTestId('my-mark')).toContainText('Explain the edge case');
  expect(await axeViolations(page)).toEqual([]);
});

test('Settings → Marking: a new rubric with two criteria; the comment bank saves one line each', async ({ page }) => {
  await open(page, 'settings');
  await expect(page.getByTestId('marking-settings')).toContainText('Lab rubric');
  await page.getByRole('button', { name: 'New rubric' }).click();
  await page.getByLabel('Rubric name').fill('Essay');
  await page.getByLabel('Criterion 1').fill('Argument');
  await page.getByRole('button', { name: 'Add a criterion' }).click();
  await page.getByLabel('Criterion 2').fill('Sources');
  await page.getByRole('button', { name: 'Save rubric' }).click();
  const rubric = (await calls(page)).find((c: unknown[]) => c[0] === 'rubric')[1];
  expect([rubric.name, rubric.criteria.map((c: { name: string }) => c.name)]).toEqual(['Essay', ['Argument', 'Sources']]);
  await expect(page.getByRole('textbox', { name: 'Comment bank' })).toHaveValue('Cite your sources');
  await expect(page.getByTestId('marking-settings')).toContainText('Suggested from your recent return reasons');
  await page.getByRole('textbox', { name: 'Comment bank' }).fill('Good start\nCite sources');
  await page.getByRole('button', { name: 'Save comment bank' }).click();
  expect((await calls(page)).at(-1)).toEqual(['bank', ['Good start', 'Cite sources']]);
  await expect(page.getByRole('button', { name: 'Save comment bank' })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});

test('Adjust for one person on a team copy: shows the adjustment; a new one needs a member, a mark and a reason', async ({ page }) => {
  await open(page, 'panel', true);
  await page.getByText('Adjust for one person').click();
  await expect(page.getByTestId('adjust-for-one')).toContainText('K. Shah 30 / 50 · Missed two sessions');
  await page.getByLabel('Team member').selectOption('u1');
  await page.getByLabel('Their mark out of 50').fill('35');
  await page.getByLabel('Reason').fill('Led the demo');
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  expect((await calls(page)).at(-1)).toEqual(['adjust', 'u1', 35, 'Led the demo']);
  expect(await axeViolations(page)).toEqual([]);
});

test('second marking: the second marker sees the first mark, gives theirs, and Needs agreement asks for one agreed mark', async ({ page }) => {
  await open(page, 'panel', false, true);
  const box = page.getByTestId('second-marking');
  await expect(box).toContainText('First mark 30 / 50 by Dr Rao');
  await expect(box).toContainText('Needs agreement: 30 and 40 differ by more than 10%.');
  await page.getByLabel('Agreed mark out of 50').fill('36');
  await page.getByRole('button', { name: 'Save agreed mark' }).click();
  expect((await calls(page)).at(-1)).toEqual(['agree', 36]);
  expect(await axeViolations(page)).toEqual([]);
});
