import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B3.5a–b (report 32.6 calls 3–5, 8).
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readStaffGrowthSettingsAction: async () => ({ success: true, reportsTo: {}, headings: ['Teaching and learning'], staff: [{ id: 'h', name: 'Head Teacher' }, { id: 'a', name: 'Asha Rao' }] }),
      saveStaffGrowthSettingsAction: async (_s: string, v: unknown) => { calls.push(['settings', v]); return { success: true }; },
      readGrowthAction: async () => ({ success: true, person: 'a', personName: 'Asha Rao', mine: true, headings: ['Teaching and learning'], manager: 'Head Teacher', myReports: [], colleagues: [{ id: 'r', name: 'Ravi Iyer' }],
        goals: [{ id: 'g1', kind: 'goal', title: 'Better questions', body: {}, created_at: '2026-09-02', by: 'Asha Rao' }], review: { id: 'r', kind: 'review', title: 'Year review 2026', body: { manager: 'Strong progress' }, created_at: '2026-09-02', by: 'Head Teacher' }, log: [] }),
      readGrowthCountsAction: async () => ({ success: false, error: 'x' }),
      saveGrowthAction: async (_s: string, _p: unknown, v: unknown) => { calls.push(['save', v]); return { success: true }; },
      readObservationsAction: async () => ({ success: true, counts: null, myReports: [],
        ofMe: [{ id: 'o1', day: '2026-09-10', focus: 'Questioning', observer: 'Ravi Iyer', observed: 'Asha Rao', state: 'written', read: false, justBetweenUs: false, strengths: 'Wait time', nextStep: 'Cold call' }],
        giving: [{ id: 'o2', day: '2026-09-11', focus: 'Starters', observer: 'Asha Rao', observed: 'Ravi Iyer', state: 'booked', read: false, justBetweenUs: true, strengths: null, nextStep: null }] }),
      bookObservationAction: async (_s: string, v: unknown) => { calls.push(['book', v]); return { success: true, id: 'o3' }; },
      writeObservationAction: async (_s: string, id: string, v: unknown) => { calls.push(['write', id, v]); return { success: true }; },
      readObservationAction: async (_s: string, id: string) => { calls.push(['read', id]); return { success: true }; },
    };
  });
  await openApp(page, 'tests/browser/school-year.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Settings → Staff growth: Reports to per person and the review headings', async ({ page }) => {
  await open(page, 'growth-settings');
  const s = page.getByTestId('staff-growth-settings');
  await s.getByLabel('Asha Rao reports to').selectOption({ label: 'Head Teacher' });
  expect(await axeViolations(page)).toEqual([]);
  await s.getByRole('button', { name: 'Save staff growth' }).click();
  await expect.poll(async () => ((await calls(page))[0]?.[1] as { reportsTo: Record<string, string> })?.reportsTo).toEqual({ a: 'h' });
});

test('Growth: my goals, the year review in words (my parts editable, the line manager’s read-only), the log', async ({ page }) => {
  await open(page, 'growth');
  const v = page.getByTestId('growth-view');
  await expect(v).toContainText('Line manager: Head Teacher');
  await expect(v.getByRole('listitem').first()).toHaveText('Better questions');
  const r = page.getByTestId('year-review');
  await expect(r).toContainText('words only, no ratings');
  await expect(r).toContainText('Strong progress');
  await r.getByLabel('Self-reflection').fill('More wait time after questions');
  expect(await axeViolations(page)).toEqual([]);
  await r.getByRole('button', { name: 'Save the review' }).click();
  await expect.poll(async () => ((await calls(page)).at(-1) as [string, { body: Record<string, string> }])?.[1]?.body).toEqual({ reflection: 'More wait time after questions' });
});

test('Observations: read my feedback, write Strengths and One next step after the lesson, book with notice', async ({ page }) => {
  await open(page, 'growth');
  const o = page.getByTestId('observations');
  await expect(o).toContainText('feedback only: Strengths and One next step');
  await expect(o.getByLabel('Observations of me')).toContainText('Feedback ready');
  await expect(o.getByLabel('Observations of me')).not.toContainText('Wait time');
  await o.getByRole('button', { name: 'Read the feedback' }).click();
  await expect.poll(async () => (await calls(page)).some((c: unknown[]) => c[0] === 'read' && c[1] === 'o1')).toBe(true);
  await expect(o.getByLabel('Observations I give')).toContainText('just between us');
  await o.getByLabel('Strengths for Ravi Iyer').fill('Clear routines');
  await o.getByLabel('One next step for Ravi Iyer').fill('Shorter starter');
  await o.getByRole('button', { name: 'Send the feedback' }).click();
  await expect.poll(async () => (await calls(page)).find((c: unknown[]) => c[0] === 'write')?.[2]).toEqual({ strengths: 'Clear routines', nextStep: 'Shorter starter' });
  const b = page.getByTestId('book-observation');
  await b.getByLabel('Who to observe').selectOption({ label: 'Ravi Iyer' });
  await b.getByLabel('Observation day (2 school days’ notice)').fill('2026-12-02');
  await b.getByLabel('Observation focus').fill('Questioning');
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
  await b.getByRole('button', { name: 'Book' }).click();
  await expect.poll(async () => (await calls(page)).find((c: unknown[]) => c[0] === 'book')?.[1]).toEqual({ observedId: 'r', day: '2026-12-02', focus: 'Questioning', justBetweenUs: false });
});
