import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B4.5 (report 33.6).
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readAskableTeamsAction: async () => ({ success: true, teams: [{ id: 'it', title: 'IT', types: [{ id: 'hw', name: 'Hardware', questions: [{ id: 'what', label: 'What do you need?', kind: 'text', required: true }, { id: 'when', label: 'By when?', kind: 'date', required: false }] }] }] }),
      matchingPagesAction: async () => ({ success: true, pages: [{ slug: 'laptop-policy', title: 'Laptop policy' }] }),
      askTeamAction: async (_o: string, v: unknown) => { calls.push(['ask', v]); return { success: true, id: 'r1' }; },
      readMyAsksAction: async () => ({ success: true, asks: [{ id: 'r0', title: 'VPN access', team: 'IT', stage: 'delivered', stageWord: 'Delivered', declineReason: null, solved: null, at: '2026-11-20' }] }),
      answerMyAskAction: async (_o: string, id: string, v: unknown) => { calls.push(['answer', id, v]); return { success: true }; },
      readCompanyRequestsSettingAction: async () => ({ success: true, available: true, on: false }),
      setCompanyRequestsAction: async (t: string, on: boolean) => { calls.push(['switch', t, on]); return { success: true }; },
    };
  });
  await openApp(page, 'tests/browser/company-requests.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Ask a team: team, type, a line and the questions; matching handbook pages first; My asks with Did this solve it?', async ({ page }) => {
  await open(page, 'ask');
  const c = page.getByTestId('ask-team');
  await c.getByLabel('Team').selectOption({ label: 'IT' });
  await c.getByLabel('Request type').selectOption({ label: 'Hardware' });
  await c.getByLabel('What you need').fill('A new laptop please');
  await expect(page.getByTestId('matching-pages')).toContainText('Laptop policy');
  await c.getByLabel('What do you need? *').fill('A 14-inch laptop');
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
  await c.getByRole('button', { name: 'Send' }).click();
  await expect.poll(async () => (await calls(page))[0]).toEqual(['ask', { teamId: 'it', typeId: 'hw', title: 'A new laptop please', answers: { what: 'A 14-inch laptop' } }]);
  const mine = page.getByTestId('my-asks');
  await expect(mine).toContainText('VPN access');
  await mine.getByRole('button', { name: 'Yes' }).click();
  await expect.poll(async () => (await calls(page)).find((x: unknown[]) => x[0] === 'answer')).toEqual(['answer', 'r0', { solved: 'yes', note: undefined }]);
});

test("the team's switch: Take requests from the company", async ({ page }) => {
  await open(page, 'switch');
  await page.getByLabel('Take requests from the company').check();
  await expect.poll(async () => (await calls(page))[0]).toEqual(['switch', 't1', true]);
});
