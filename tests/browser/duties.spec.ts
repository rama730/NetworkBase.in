import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B3.4c (report 32.5 calls 3, 9).
async function open(page: Page) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readDutiesAction: async () => ({ success: true, leader: true, me: 'a', staff: [{ id: 'a', name: 'Asha Rao' }, { id: 'r', name: 'Ravi Lee' }],
        duties: [{ id: 'd1', place: 'Gate', day: 1, slot: 'Break', week: null, user_id: 'a', name: 'Asha Rao' }, { id: 'd2', place: 'Lunch hall', day: 3, slot: 'Lunch', week: 'A', user_id: 'r', name: 'Ravi Lee' }],
        askedOfMe: [{ id: 's9', day: '2026-12-02', place: 'Bus bay', slot: 'After school', from: 'Ravi Lee' }], myAsks: [] }),
      answerDutySwapAction: async (_s: string, id: string, yes: boolean) => { calls.push(['answer', id, yes]); return { success: true }; },
      askDutySwapAction: async (_s: string, id: string, _d: string, to: string) => { calls.push(['ask', id, to]); return { success: true }; },
      saveDutyAction: async (_s: string, v: unknown) => { calls.push(['save', v]); return { success: true }; },
      removeDutyAction: async () => ({ success: true }),
    };
  });
  await openApp(page, 'tests/browser/school-year.fixture.tsx', { path: '/?view=duties' });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('duties: the grid, a swap asked of me, asking to swap, and a leader adds a duty', async ({ page }) => {
  await open(page);
  const v = page.getByTestId('duties-view');
  await expect(v.getByRole('region', { name: 'Duty grid' })).toContainText(/Gate\s*Break: Asha Rao/);
  await expect(v.getByRole('region', { name: 'Duty grid' })).toContainText('Lunch: Ravi Lee (Week A)');
  expect(await axeViolations(page)).toEqual([]);
  await v.getByRole('list', { name: 'Swaps asked of me' }).getByRole('button', { name: 'Accept' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['answer', 's9', true]);
  await v.getByRole('button', { name: 'Ask to swap' }).click();
  await v.getByLabel('Ask who').selectOption({ label: 'Ravi Lee' });
  await v.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['ask', 'd1', 'r']);
  const n = page.getByTestId('new-duty');
  await n.getByLabel('Duty place').fill('Playground');
  await n.getByLabel('Duty time').fill('Before school');
  await n.getByLabel('Duty person').selectOption({ label: 'Ravi Lee' });
  await n.getByRole('button', { name: 'Add duty' }).click();
  await expect.poll(async () => ((await calls(page)).at(-1) as [string, { place: string; userId: string }])?.[1]).toMatchObject({ place: 'Playground', userId: 'r' });
});
