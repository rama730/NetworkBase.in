import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.12 D3 W1–W5, S1, S2 (plan A5.1a).
const U1 = '11111111-1111-4111-8111-111111111111';
async function open(page: Page, opts: { view?: string; width?: number; canEdit?: boolean; viewer?: string } = {}) {
  await page.clock.setFixedTime(new Date('2027-02-15T06:00:00Z'));
  await page.setViewportSize({ width: opts.width ?? 1100, height: 900 });
  await page.addInitScript(({ canEdit, viewer, U1 }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const kr = (over: Record<string, unknown>) => ({ id: 'k1', number: 12, title: 'Weekly active teams', assigneeId: U1, assigneeName: 'Asha', start: 10, target: 50, current: 30, direction: 'increase', unit: 'teams',
      confidence: 7, checkedInAt: '2027-02-11T06:00:00Z', progress: 50, status: 'on_track', override: null, result: null, history: [{ value: 20, at: '2027-02-01T06:00:00Z' }, { value: 30, at: '2027-02-11T06:00:00Z' }], ...over });
    (window as any).__actions = {
      readGoalsAction: async () => ({ success: true, period: '2027-Q1', label: 'Q1 2027', week: 'week 7 of 13', pace: 50, canEdit, closedAt: null, viewerId: viewer,
        objectives: [{ id: 'o1', number: 11, title: 'Teams love the app', assigneeId: U1, assigneeName: 'Asha', progress: 37, status: 'at_risk', override: null,
          keyResults: [kr({}), kr({ id: 'k2', title: 'Support tickets', direction: 'decrease', start: 40, target: 10, current: 32, unit: '', progress: 26, status: 'off_track', assigneeId: null, assigneeName: null, confidence: null, checkedInAt: null, history: [] })] }],
        people: [{ id: U1, name: 'Asha' }] }),
      addObjectiveAction: async (_p: string, input: unknown) => { calls.push(['objective', input]); return { success: true, id: 'o2' }; },
      addKeyResultAction: async (_p: string, input: unknown) => { calls.push(['kr', input]); return { success: true, id: 'k3' }; },
      checkInAction: async (_p: string, input: unknown) => { calls.push(['checkin', input]); return { success: true }; },
      setGoalStatusAction: async (_p: string, input: unknown) => { calls.push(['status', input]); return { success: true }; },
      ensureDocsFolderAction: async () => ({ success: true, folderId: 'f1' }),
    };
  }, { canEdit: opts.canEdit ?? true, viewer: opts.viewer ?? 'someone-else', U1 });
  await openApp(page, 'tests/browser/goals-doc.fixture.tsx', opts.view ? { path: `/?view=${opts.view}` } : undefined);
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('S1: period and week, objectives with progress and status in words, key results with current / target, confidence, last check-in', async ({ page }) => {
  await open(page);
  const block = page.getByTestId('goals-block');
  await expect(block.getByTestId('goals-period')).toHaveText('Q1 2027 · week 7 of 13');
  const o = block.getByTestId('objective');
  await expect(o).toContainText(/Teams love the app\s*Asha\s*37%\s*At risk/);
  const krs = block.getByTestId('key-result');
  await expect(krs.first()).toContainText(/Weekly active teams\s*30 \/ 50 teams\s*50%\s*7\/10\s*On track\s*4 d ago/);
  await expect(krs.nth(1)).toContainText(/Support tickets\s*32 \/ 10 · lower is better\s*26%\s*Off track\s*no check-in yet/);
  await expect(block.getByRole('progressbar', { name: 'Weekly active teams progress' })).toHaveAttribute('aria-valuenow', '50');
  await page.screenshot({ path: 'test-results/goals-doc/block.png' });
  expect(await axeViolations(page)).toEqual([]);
});

test('W2 and W3: + Objective adds on Enter; + Key result checks its fields and sends them', async ({ page }) => {
  await open(page);
  const block = page.getByTestId('goals-block');
  await block.getByLabel('New objective').fill('Ship the mobile app');
  await block.getByLabel('New objective').press('Enter');
  await block.getByRole('button', { name: 'Key result' }).click();
  const d = page.getByTestId('kr-dialog');
  await d.getByRole('button', { name: 'Add key result' }).click();
  await expect(d).toContainText('Name the key result');
  await d.getByLabel('Key result').fill('App store rating');
  await d.getByRole('button', { name: 'Add key result' }).click();
  await expect(d).toContainText('Give a start and a target');
  await d.getByLabel('Start').fill('3.9');
  await d.getByLabel('Target').fill('4.5');
  await d.getByLabel('Assigned to').selectOption({ label: 'Asha' });
  await d.getByRole('button', { name: 'Add key result' }).click();
  await expect(d).toHaveCount(0);
  expect(await calls(page)).toEqual([
    ['objective', { docSlug: 'goals-2027-q1', title: 'Ship the mobile app' }],
    ['kr', { docSlug: 'goals-2027-q1', objectiveId: 'o1', title: 'App store rating', direction: 'increase', unit: '', start: 3.9, target: 4.5, assigneeId: U1 }],
  ]);
});

test('W4 and S2: Check in asks the value, confidence with words and a note; past check-ins as a line and a table', async ({ page }) => {
  await open(page);
  await page.getByTestId('key-result').first().getByRole('button', { name: 'Check in' }).click();
  const d = page.getByTestId('checkin-dialog');
  await expect(d).toContainText('Target 50 teams · now 30');
  await expect(d.getByRole('table', { name: 'Past check-ins' })).toHaveCount(1);
  await d.getByLabel('New value').fill('38');
  await d.getByLabel(/Confidence/).fill('9');
  await expect(d).toContainText('Confidence: 9/10 · High');
  await d.getByLabel('Note').fill('Two big teams joined');
  await page.screenshot({ path: 'test-results/goals-doc/checkin.png' });
  await d.getByRole('button', { name: 'Check in' }).click();
  await expect(d).toHaveCount(0);
  expect(await calls(page)).toEqual([['checkin', { taskId: 'k1', value: 38, confidence: 9, note: 'Two big teams joined' }]]);
});

test('W5: Status… sets it by hand with a reason', async ({ page }) => {
  await open(page);
  await page.getByTestId('objective').getByRole('button', { name: 'Status…' }).click();
  const d = page.getByTestId('goal-status-dialog');
  await d.getByLabel('Status').selectOption('off_track');
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(d).toContainText('Say why');
  await d.getByLabel('Why').fill('Hiring slipped');
  await d.getByRole('button', { name: 'Save' }).click();
  expect(await calls(page)).toEqual([['status', { taskId: 'o1', status: 'off_track', reason: 'Hiring slipped' }]]);
});

test('Read-only: someone who can’t edit sees no adds; the assignee still checks in; Mine filters', async ({ page }) => {
  await open(page, { canEdit: false, viewer: U1 });
  const block = page.getByTestId('goals-block');
  await expect(block.getByLabel('New objective')).toHaveCount(0);
  await expect(block.getByRole('button', { name: 'Key result' })).toHaveCount(0);
  await expect(block.getByTestId('key-result').first().getByRole('button', { name: 'Check in' })).toBeVisible();
  await expect(block.getByTestId('key-result').nth(1).getByRole('button', { name: 'Check in' })).toHaveCount(0);
  await block.getByLabel('Mine').check();
  await expect(block.getByTestId('objective')).toHaveCount(1);
});

test('W1 and W9: Set goals offers this period and the next three; phone width has no accessibility violations', async ({ page }) => {
  await open(page, { view: 'new', width: 375 });
  const d = page.getByTestId('new-goals-dialog');
  await expect(d.getByLabel('Period').locator('option')).toHaveText(['Q1 2027', 'Q2 2027', 'Q3 2027', 'Q4 2027']);
  await expect(d.getByRole('button', { name: 'Set Q1 2027 goals' })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});
