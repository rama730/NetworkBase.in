import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B3.2b (report 32.3 Year map).
const weeks = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-10-26'].map((start, i) => ({ start, off: i === 4, holiday: i === 4 ? 'Half-term' : null, label: i < 4 ? `Term 1 · W${i + 1}` : null }));
async function open(page: Page, width = 1100) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((w) => {
    (window as any).__actions = {
      readYearMapAction: async () => ({ success: true, leader: true, weeks: w, departments: [{ id: 'sci', name: 'Science' }], rows: [
        { id: 'c1', title: 'Grade 6 Science', slug: 'g6-sci', department: 'sci', planned: { ready: 9, total: 10, percent: 90 },
          segments: [{ kind: 'unit', span: 2, name: 'Cells', draft: false, assessment: true, from: '2026-08-31', to: '2026-09-07' }, { kind: 'unit', span: 2, name: 'Forces', draft: true, assessment: false, from: '2026-09-14', to: '2026-09-21' }, { kind: 'gap', span: 1 }],
          taught: [{ group: '6A', due: 4, taught: 4, behind: 0, warn: false }, { group: '6B', due: 4, taught: 2, behind: 2, warn: true }] },
        { id: 'c2', title: 'Art club', slug: null, department: null, planned: { ready: 0, total: 0, percent: 0 }, segments: [{ kind: 'gap', span: 5 }], taught: [] },
      ] }),
    };
  }, weeks);
  await openApp(page, 'tests/browser/school-year.fixture.tsx', { path: '/?view=map' });
}

test('Year map: courses by department, units as spans with Draft and assessment in words, holidays, Planned and Behind the map', async ({ page }) => {
  await open(page);
  const map = page.getByTestId('year-map');
  await expect(map.getByRole('rowheader', { name: 'Science', exact: true })).toBeVisible();
  await expect(map.getByRole('rowheader', { name: 'No department' })).toBeVisible();
  const row = map.getByTestId('map-row').first();
  await expect(row.getByRole('cell', { name: /Cells, Ready, Aug 31 to the week of Sep 7, has an assessment/ })).toBeVisible();
  await expect(row.getByRole('cell', { name: /Forces, Draft/ })).toBeVisible();
  await expect(row).toContainText(/Planned 90%\s*6A 4\/4\s*6B 2\/4\s*Behind the map/);
  await expect(map.getByRole('columnheader', { name: /Week of Oct 26, Half-term/ })).toBeVisible();
  await expect(map.getByTestId('map-row').nth(1)).toContainText('No lessons yet');
  expect(await axeViolations(page)).toEqual([]);
});

test('on a phone the map is a list per course', async ({ page }) => {
  await open(page, 375);
  const list = page.getByTestId('year-map-list');
  await expect(list).toContainText('Grade 6 Science');
  await expect(list).toContainText('Forces · Draft');
  await expect(list).toContainText('Cells · Ready · Assessment');
});
