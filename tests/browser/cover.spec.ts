import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B3.4b (report 32.5 calls 5–7).
async function open(page: Page) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readCoverBoardAction: async (_s: string, day: string) => ({ success: true, day, needsDay: false, filled: 1, staff: [{ id: 'a', name: 'Asha Rao' }, { id: 'm', name: 'Mo Khan' }],
        absences: [{ id: 'x', name: 'Asha Rao', from: 'P2', to: 'P3', reason: 'Doctor' }],
        slots: [
          { id: 's1', period: 'P3', className: '6B', room: 'S1', teacher: 'Asha Rao', cover: null, suggestions: [{ userId: 'm', name: 'Mo Khan', reason: 'free P3, same department, 0 covers this term' }] },
          { id: 's2', period: 'P2', className: '7C', room: 'S4', teacher: 'Asha Rao', cover: { name: 'Ravi Lee', userId: 'r', note: null }, suggestions: [] }] }),
      assignCoverAction: async (_s: string, slot: string, _d: string, user: string) => { calls.push(['assign', slot, user]); return { success: true }; },
      reportAbsenceAction: async (_s: string, v: unknown) => { calls.push(['absence', v]); return { success: true }; },
    };
  });
  await openApp(page, 'tests/browser/school-year.fixture.tsx', { path: '/?view=cover' });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('cover board: Filled 1 of 2, open slots first with suggestions and reasons; the manager picks; report an absence by periods', async ({ page }) => {
  await open(page);
  const b = page.getByTestId('cover-board');
  await expect(b).toContainText('Filled 1 of 2');
  await expect(b.getByRole('list', { name: 'Away' })).toContainText(/Asha Rao\s*P2–P3\s*· Doctor/);
  await expect(b.getByTestId('cover-slot').first()).toContainText(/P3\s*6B\s*S1\s*· Asha Rao away\s*Open/);
  await expect(b.getByTestId('cover-slot').nth(1)).toContainText(/Filled\s*Cover: Ravi Lee/);
  expect(await axeViolations(page)).toEqual([]);
  await b.getByRole('button', { name: /Mo Khan \(free P3, same department, 0 covers this term\)/ }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['assign', 's1', 'm']);
  const r = page.getByTestId('report-absence');
  await r.getByLabel('Who is away').selectOption({ label: 'Mo Khan' });
  await r.getByLabel('From period (blank for the whole day)').fill('P1');
  await r.getByLabel('To period').fill('P2');
  await r.getByRole('button', { name: 'Add absence' }).click();
  await expect.poll(async () => ((await calls(page)).at(-1) as [string, { userId: string; from: string; to: string }])?.[1]).toMatchObject({ userId: 'm', from: 'P1', to: 'P2' });
});
