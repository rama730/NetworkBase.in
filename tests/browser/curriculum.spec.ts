import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B3.2c (report 32.3 calls 5, 6, 9).
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readCurriculumAction: async () => ({ success: true, canEdit: true, standards: [{ code: 'SC6.3', text: 'Forces', grade: '6', subject: 'Science' }], template: ['Objective', 'Starter', 'Main'], publicOverview: false }),
      saveCurriculumAction: async (_s: string, p: unknown) => { calls.push(['save', p]); return { success: true, retired: 0 }; },
      readStandardsCoverageAction: async () => ({ success: true, covered: 1, total: 2, rows: [
        { code: 'SC6.3', text: 'Forces', grade: '6', subject: 'Science', lessons: 2, courses: ['Grade 6 Science'] },
        { code: 'SC6.4', text: 'Friction', grade: '6', subject: 'Science', lessons: 0, courses: [] }] }),
      readCurriculumOverviewAction: async () => ({ success: true, courses: [{ course: 'Grade 6 Science', units: [{ name: 'Cells', start: '2026-09-01' }, { name: 'Forces', start: '2026-10-01' }] }] }),
    };
  });
  await openApp(page, 'tests/browser/school-year.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Settings → Teaching: import standards from a CSV with a preview, edit the template, turn on the overview', async ({ page }) => {
  await open(page, 'teaching');
  const s = page.getByTestId('teaching-settings');
  await expect(s).toContainText('1 standard. Import a CSV');
  await s.getByLabel('Standards CSV').setInputFiles({ name: 's.csv', mimeType: 'text/csv', buffer: Buffer.from('code,description,grade,subject\nSC6.3,Forces,6,Science\nSC6.4,Friction,6,Science\n,x,6,Science') });
  await expect(page.getByTestId('standards-preview')).toContainText('2 standards ready · 1 rows skipped');
  expect(await axeViolations(page)).toEqual([]);
  await s.getByRole('button', { name: 'Save 2 standards' }).click();
  await expect.poll(async () => ((await calls(page))[0]?.[1] as { standards: Array<{ code: string }> })?.standards.map((x) => x.code)).toEqual(['SC6.3', 'SC6.4']);
  await s.getByLabel('Lesson template sections').fill('I do, We do, You do');
  await s.getByRole('button', { name: 'Save lesson template' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['save', { template: ['I do', 'We do', 'You do'] }]);
  await s.getByLabel('Show the curriculum overview on About (unit titles only)').click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['save', { publicOverview: true }]);
});

test('Standards view: covered of total, courses per standard, Not covered yet in words and as a filter; the public overview', async ({ page }) => {
  await open(page, 'standards');
  const v = page.getByTestId('standards-view');
  await expect(v).toContainText('Standards covered 1 of 2');
  await expect(v.getByTestId('standard-row').first()).toContainText('Grade 6 Science · 2 lessons');
  await expect(v.getByTestId('standard-row').nth(1)).toContainText('Not covered yet');
  await v.getByLabel('Not covered yet only').check();
  await expect(v.getByTestId('standard-row')).toHaveCount(1);
  expect(await axeViolations(page)).toEqual([]);
  await open(page, 'overview');
  await expect(page.getByTestId('curriculum-overview')).toContainText('Grade 6 Science: Cells · Forces');
});
