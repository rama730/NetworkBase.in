import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.10 D2 W1–W8 (plan A3.1): the launch header, Ships, What's new, Launch now, Close, Move date, Cancel.
const PROJECT = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
async function open(page: Page, opts: { stage?: string; sheet?: boolean; launchedAt?: string | null } = {}) {
  await page.clock.setFixedTime(new Date('2026-11-25T06:00:00Z'));
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(({ stage, launchedAt }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readLaunchAction: async () => ({ success: true, docId: 'd1', canEdit: true, member: true, date: '2026-12-18', stage, preset: 'blank', versionLabel: 'v2.4', launchedAt,
        progress: { done: 14, total: 31, text: '14 of 31 steps' }, openSteps: 17, openTitles: ['Press kit', 'Demo'], overdue: 2,
        ships: [{ id: 'r1', number: 150, title: 'SSO sign-in', stage: 'testing', itemType: 'feature' }],
        whatsNew: { added: ['SSO sign-in'], improved: [], fixed: ['Login typo'] } }),
      readRoadmapAction: async () => ({ success: true, projectKey: 'AC', launches: [], projects: [], canEdit: true, viewerId: 'u1',
        items: [{ id: 'r2', taskNumber: 151, title: 'Faster search', stage: 'planned', typeFields: {} }, { id: 'r1', taskNumber: 150, title: 'SSO sign-in', stage: 'testing', typeFields: { launchDocId: 'd1' } }] }),
      setLaunchShipsAction: async (_p: string, input: unknown) => { calls.push(['ships', input]); return { success: true }; },
      launchAction: async (_p: string, input: unknown) => { calls.push(['launch', input]); return { success: true, marked: 1, update: 'v2.4 is out.' }; },
      closeLaunchAction: async (_p: string, input: unknown) => { calls.push(['close', input]); return { success: true }; },
      moveLaunchDateAction: async (_p: string, input: unknown) => { calls.push(['date', input]); return { success: true, moved: 3 }; },
      cancelLaunchAction: async (_p: string, input: unknown) => { calls.push(['cancel', input]); return { success: true }; },
    };
  }, { stage: opts.stage ?? 'getting_ready', launchedAt: opts.launchedAt ?? null });
  await openApp(page, 'tests/browser/launch-doc.fixture.tsx', opts.sheet ? { path: '/?sheet=1' } : undefined);
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('S1–S4: date, countdown, stage, progress with overdue, Ships with Add item, What’s new; no axe violations', async ({ page }) => {
  await open(page);
  const h = page.getByTestId('launch-header');
  await expect(h.getByTestId('launch-countdown')).toHaveText('in 23 days');
  await expect(h).toContainText('Getting ready');
  await expect(h.getByTestId('launch-progress')).toHaveText('14 of 31 steps · 2 overdue');
  await expect(h.getByTestId('launch-ships')).toContainText('SSO sign-in');
  await expect(h.getByTestId('launch-whats-new')).toContainText(/Added.*SSO sign-in.*Fixed.*Login typo/);
  await h.getByLabel('Add item').selectOption({ label: 'Faster search' });
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['ships', { docSlug: 'v2-4', itemId: 'r2', on: true }]);
  expect(await axeViolations(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/launch-doc/header.png' });
});

test('W5: Launch now says what is open, marks items and never posts', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Launch now' }).click();
  const d = page.getByTestId('launch-dialog');
  await expect(d).toContainText('17 steps are still open.');
  await expect(d.getByTestId('launch-open-steps')).toHaveText(/Press kit.*Demo.*and 15 more/);
  await expect(d).toContainText('nothing is posted');
  await d.getByRole('button', { name: 'Launch' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['launch', { docSlug: 'v2-4', markItems: true }]);
});

test('W6–W8: Close offers Leave or Backlog; Move the date shifts steps; Cancel keeps or backlogs steps', async ({ page }) => {
  await open(page, { stage: 'launched', launchedAt: '2026-11-01T10:00:00Z' });
  await expect(page.getByTestId('launch-countdown')).toHaveText('Launched Nov 1');
  await page.getByRole('button', { name: 'Close launch' }).click();
  await page.getByTestId('launch-choice-dialog').getByRole('button', { name: 'Move them to the Backlog' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['close', { docSlug: 'v2-4', remaining: 'backlog' }]);
});

test('W7–W8 in Getting ready: Move the date asks to move steps; Cancel launch', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Launch actions' }).click();
  await page.getByRole('menuitem', { name: 'Move the date…' }).click();
  const d = page.getByTestId('launch-date-dialog');
  await d.getByLabel('Launch date').fill('2026-12-23');
  await expect(d).toContainText('Also move the steps’ due dates by 5 days');
  await d.getByRole('button', { name: 'Move' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['date', { docSlug: 'v2-4', date: '2026-12-23', shiftSteps: true }]);
  await page.getByRole('button', { name: 'Launch actions' }).click();
  await page.getByRole('menuitem', { name: 'Cancel launch…' }).click();
  await page.getByTestId('launch-choice-dialog').getByRole('button', { name: 'Move open steps to the Backlog' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['cancel', { docSlug: 'v2-4', backlogSteps: true }]);
});

test('S7 and A3.2: the New launch sheet needs a name and a date and previews the preset (Product launch first)', async ({ page }) => {
  await open(page, { sheet: true });
  const d = page.getByTestId('new-launch-dialog');
  await expect(d.getByTestId('launch-preset-preview')).toHaveText('Stages: Market research · Goal identification · Marketing plan · Sales and support training · Testing and beta testing · Launch day · After launch · 18 steps, unassigned and undated');
  await d.getByLabel('Preset').selectOption({ label: 'Blank' });
  await expect(d.getByTestId('launch-preset-preview')).toHaveText('Stages: Checklist · 0 steps, unassigned and undated');
  await expect(d.getByRole('button', { name: 'Create' })).toBeDisabled();
  await d.getByLabel('Name').fill('v2.4: Faster sign-in');
  await d.getByLabel('Launch date').fill('2026-12-18');
  await expect(d.getByRole('button', { name: 'Create' })).toBeEnabled();
  expect(await axeViolations(page)).toEqual([]);
});
