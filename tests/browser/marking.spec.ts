import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 30.8 W7 (plan B1.5a).
const LEVELS = [{ label: 'Excellent', points: 10, text: '' }, { label: 'Good', points: 7, text: '' }, { label: 'Fair', points: 4, text: '' }, { label: 'Missing', points: 0, text: '' }];
const RUBRIC = { id: 'r1', name: 'Lab rubric', criteria: [{ id: 'c1', name: 'Correctness', levels: LEVELS }, { id: 'c2', name: 'Report', levels: LEVELS }] };
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.addInitScript((s) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readMarkingAction: async () => ({ success: true, marking: { mode: 'rubric', rubric: s.rubric }, mark: null, excused: false, commentBank: ['Show your working'] }),
      saveMarkAction: async (_c: string, d: { levels: Record<string, number> }) => {
        calls.push(['mark', d]);
        return Object.keys(d.levels).length < 2 ? { success: false, error: 'Pick a level for Report.' } : { success: true, total: 17, outOf: 20 };
      },
      readMyMarkAction: async () => ({ success: true, marking: { mode: 'rubric', rubric: s.rubric }, mark: { total: 17, outOf: 20, levels: { c1: 0, c2: 1 }, comment: 'Explain the edge case', marker: 'Dr Rao', markedAt: '', visible: true } }),
      readMarkingSettingsAction: async () => ({ success: true, teacher: true, rubrics: [s.rubric], commentBank: [] }),
      saveRubricAction: async (_o: string, r: unknown) => { calls.push(['rubric', r]); return { success: true, id: 'r2' }; },
      archiveRubricAction: async () => ({ success: true }),
      saveCommentBankAction: async (_o: string, l: string[]) => { calls.push(['bank', l]); return { success: true }; },
    };
  }, { rubric: RUBRIC });
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
  await expect(page.getByTestId('marking-panel')).toContainText('Hidden until you approve');
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
  await page.getByRole('textbox', { name: 'Comment bank' }).fill('Good start\nCite sources');
  await page.getByRole('button', { name: 'Save comment bank' }).click();
  expect((await calls(page)).at(-1)).toEqual(['bank', ['Good start', 'Cite sources']]);
  expect(await axeViolations(page)).toEqual([]);
});
