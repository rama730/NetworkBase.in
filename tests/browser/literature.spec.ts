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

// Report 35.4 (B6.4c): inside a research lab — link rows to the lab's Library; a systematic review screens them.
test('Literature in a lab: In the lab’s Library, Add to the lab’s Library, Link all; screening with counts and an Excluded reason', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readLiteratureAction: async () => ({ success: true, lab: { orgId: 'lab-1' }, systematic: true, rows: [
        { id: 's1', title: 'Graph networks for traffic', authors: 'Rao, A.', year: 2020, link: null, doi: null, keyIssues: [], summary: null, createdAt: '', labSourceId: 'L1', screening: 'included', excludeReason: null },
        { id: 's2', title: 'Low-power sensors', authors: null, year: 2019, link: null, doi: null, keyIssues: [], summary: null, createdAt: '', labSourceId: null, screening: 'found', excludeReason: null },
      ] }),
      linkToLabLibraryAction: async (_p: string, ids: string[]) => { calls.push(['link', ids]); return { success: true, linked: ids.length }; },
      setScreeningAction: async (_p: string, id: string, v: unknown) => { calls.push(['screen', id, v]); return { success: true }; },
      setSystematicReviewAction: async () => ({ success: true }),
    };
  });
  await openApp(page, 'tests/browser/literature.fixture.tsx');
  const view = page.getByTestId('literature-view');
  await expect(view.getByRole('link', { name: 'The lab’s Library' })).toHaveAttribute('href', '/org/lab-1?tab=docs&library=all');
  await expect(view).toContainText('In the lab’s Library');
  await expect(page.getByTestId('screening-counts')).toHaveText('2 found, 1 screened, 1 included, 0 excluded');
  await view.getByRole('button', { name: 'Add to the lab’s Library Low-power sensors' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['link', ['s2']]);
  await view.getByLabel('Screening for Low-power sensors').selectOption('excluded');
  await view.getByLabel('Why Low-power sensors is excluded').fill('Not low-light');
  await view.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['screen', 's2', { state: 'excluded', reason: 'Not low-light' }]);
  expect(await axeViolations(page)).toEqual([]);
});
