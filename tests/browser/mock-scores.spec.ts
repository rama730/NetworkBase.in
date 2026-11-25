import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B2.4a (report 31.4 C3).
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const layout = { series: 'IELTS mocks', overall: 'average_half', sections: [{ key: 'listening', name: 'Listening', max: 40, conversion: [[39, 9], [30, 7], [0, 4]] }, { key: 'writing', name: 'Writing', max: 9 }] };
    (window as any).__actions = {
      readScoresAction: async () => ({ success: true, series: ['IELTS mocks'], picked: 'IELTS mocks', exams: [{ id: 'e9', title: 'Mock 3' }], layout,
        mocks: [{ id: 'm1', title: 'Mock 1', held: false }, { id: 'm2', title: 'Mock 2', held: true }],
        learners: [{ id: 'u1', name: 'A. Rao', examDate: '2027-03-14', target: 7, overall: [6.5, 7], below: ['Writing'], missing: 0 }, { id: 'u2', name: 'K. Shah', examDate: null, target: null, overall: [null, null], below: [], missing: 3 }],
        bands: [{ from: 7, to: null, count: 1 }, { from: 5.5, to: 7, count: 0 }, { from: -Infinity, to: 5.5, count: 0 }] }),
      saveScoreLayoutAction: async (_o: string, id: string, l: unknown) => { calls.push(['layout', id, l]); return { success: true }; },
      readMockMarksAction: async () => ({ success: true, title: 'Mock 2', layout, held: true, learners: [{ id: 'u1', name: 'A. Rao', raws: { listening: 32 } }] }),
      saveMockMarksAction: async (_o: string, id: string, rows: unknown) => { calls.push(['marks', id, rows]); return { success: true, saved: 1 }; },
      readMyPrepAction: async () => ({ success: true, exam: { name: 'IELTS Academic', date: '2027-03-14', daysToGo: 38 }, targets: { overall: 7 }, suggested: { overall: 7.5 },
        series: [{ name: 'IELTS mocks', mocks: ['Mock 1'], sections: [{ key: 'listening', name: 'Listening', target: null, values: [7], latest: 7, best: 7, gap: null, onTarget: false, trend: [7] }],
          overall: { target: 7, values: [6.5], latest: 6.5, best: 6.5, gap: 0.5, onTarget: false, trend: [6.5] } }] }),
      saveMyPrepAction: async (_o: string, input: unknown) => { calls.push(['prep', input]); return { success: true }; },
    };
  });
  await openApp(page, 'tests/browser/mock-scores.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Scores: learners × mocks, below target and missing in words, bands; set up a mock; enter marks with the band shown', async ({ page }) => {
  await open(page, 'scores');
  await expect(page.getByRole('row', { name: /A\. Rao/ })).toContainText(/2027-03-14\s*7\s*6\.5\s*7\s*Writing/);
  await expect(page.getByRole('row', { name: /K\. Shah/ })).toContainText('3 mocks missing');
  await expect(page.getByTestId('score-bands')).toContainText('Mock 2: 7+ · 1');
  const setup = page.getByTestId('mock-setup');
  await setup.getByLabel('Exam').selectOption('e9');
  await setup.getByLabel('Series name').fill('IELTS mocks');
  await setup.getByRole('button', { name: 'Set up' }).click();
  await page.getByRole('button', { name: 'Enter marks: Mock 2 (held)' }).click();
  const grid = page.getByTestId('enter-marks');
  await expect(grid).toContainText('7');
  await grid.getByLabel('Writing for A. Rao').fill('6.5');
  await grid.getByRole('button', { name: 'Save marks' }).click();
  const c = await calls(page);
  expect(c[0][0]).toBe('layout');
  expect(c[0][2]).toMatchObject({ series: 'IELTS mocks', overall: 'average_half' });
  expect(c[1]).toEqual(['marks', 'm2', [{ userId: 'u1', raws: { writing: 6.5 } }]]);
  expect(await axeViolations(page)).toEqual([]);
});

test('My prep: exam and days to go, Latest, Best and the gap; a suggestion is shown, never applied', async ({ page }) => {
  await open(page, 'prep');
  const card = page.getByTestId('my-prep');
  await expect(card).toContainText('IELTS Academic');
  await expect(card).toContainText('38 days to go');
  await expect(card).toContainText('Suggested: 7.5');
  await expect(card.getByRole('row', { name: /Overall/ })).toContainText(/7\s*6\.5\s*6\.5\s*6\.5\s*0\.5 below/);
  await expect(card).not.toContainText(/average/i);
  expect(await axeViolations(page)).toEqual([]);
});
