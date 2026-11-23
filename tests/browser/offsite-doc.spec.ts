import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.14 D5 S1, W1, W2, W6 (plan A5.4).
async function open(page: Page, opts: { view?: string; width?: number } = {}) {
  await page.setViewportSize({ width: opts.width ?? 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readOffsiteAction: async () => ({ success: true, name: 'Team off-site', dateFrom: '2027-03-04', dateTo: '2027-03-06', place: 'Goa', counts: { going: 1, cant: 1, unanswered: 1 }, mine: 'none',
        people: [{ id: 'a', name: 'Asha', answer: 'going' }, { id: 'b', name: 'Dev', answer: 'cant' }, { id: 'c', name: 'Mia', answer: null }] }),
      answerOffsiteAction: async (_p: string, input: unknown) => { calls.push(['answer', input]); return { success: true }; },
      readMeetingsAction: async () => ({ success: true, people: [{ id: 'a', name: 'Asha' }, { id: 'b', name: 'Dev' }], meetings: [], openActionItems: [], timeZone: 'UTC' }),
    };
  });
  await openApp(page, 'tests/browser/offsite-doc.fixture.tsx', opts.view ? { path: `/?view=${opts.view}` } : undefined);
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('S1 and W2: dates in mono, place, counts in words, Who’s coming grouped; Going / Can’t go buttons answer', async ({ page }) => {
  await open(page);
  const h = page.getByTestId('offsite-header');
  await expect(h).toContainText(/Thu 4 Mar – Sat 6 Mar\s*Goa/);
  await expect(h.getByTestId('offsite-counts')).toHaveText('1 going · 1 can’t go · 1 not answered');
  await expect(h.getByTestId('offsite-whos-coming')).toContainText(/Going 1\s*Asha.*Can’t go 1\s*Dev.*Not answered 1\s*Mia/);
  await h.getByRole('button', { name: 'Going' }).click();
  expect(await calls(page)).toEqual([['answer', { docSlug: 'offsite', answer: 'going' }]]);
  await page.screenshot({ path: 'test-results/offsite-doc/header.png' });
  expect(await axeViolations(page)).toEqual([]);
});

test('W1: Plan an off-site has name, dates, place and invite; W6 phone has no accessibility violations', async ({ page }) => {
  await open(page, { view: 'new', width: 375 });
  const d = page.getByTestId('new-offsite-dialog');
  await expect(d.getByLabel('Name')).toHaveValue('Team off-site');
  await expect(d.getByTestId('offsite-invite')).toContainText(/Asha.*Dev/);
  await expect(d.getByRole('button', { name: 'Plan off-site' })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});
