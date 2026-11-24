import { expect, test } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 30.6 W5 (plan B1.8b).
test('Literature: the table, by key issue, search; Paste BibTeX adds the parsed entries', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readLiteratureAction: async () => ({ success: true, rows: [
        { id: 's1', title: 'Graph networks for traffic', authors: 'Rao, A.', year: 2020, link: null, doi: '10.1/abc', keyIssues: ['traffic', 'graphs'], summary: null, createdAt: '' },
        { id: 's2', title: 'Low-power sensors', authors: null, year: 2019, link: 'https://example.com', doi: null, keyIssues: [], summary: null, createdAt: '' },
      ] }),
      addSourcesAction: async (_p: string, rows: unknown[]) => { calls.push(rows); return { success: true, added: rows.length, skipped: 0 }; },
    };
  });
  await openApp(page, 'tests/browser/literature.fixture.tsx');
  const view = page.getByTestId('literature-view');
  await expect(view).toContainText('Graph networks for traffic');
  await expect(view).toContainText('Rao, A. · 2020 · doi 10.1/abc');
  await page.getByRole('button', { name: 'By key issue' }).click();
  await expect(page.getByRole('list', { name: 'traffic' })).toContainText('Graph networks for traffic');
  await expect(page.getByRole('list', { name: 'No key issue' })).toContainText('Low-power sensors');
  await page.getByLabel('Search the literature').fill('sensors');
  await expect(view).not.toContainText('Graph networks');
  await page.getByRole('button', { name: 'Paste BibTeX' }).click();
  await page.getByLabel('BibTeX').fill('@article{x, title = {A new paper}, year = 2021}');
  await page.getByRole('button', { name: 'Add from BibTeX' }).click();
  const added = await page.evaluate(() => (window as any).__calls);
  expect(added[0][0]).toMatchObject({ title: 'A new paper', year: 2021 });
  expect(await axeViolations(page)).toEqual([]);
});
