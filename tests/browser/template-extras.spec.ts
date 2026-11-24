import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.15 calls 3, 4, 7 (plan A6.36).
async function open(page: Page, view: string, opts: { width?: number; made?: unknown[] } = {}) {
  await page.setViewportSize({ width: opts.width ?? 1000, height: 900 });
  await page.addInitScript((made) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readTemplateToolsAction: async () => ({ success: true, canEdit: true, people: [{ id: 'u1', name: 'Asha' }, { id: 'u2', name: 'Dev' }], made, review: { state: 'in_review', done: 1, total: 2 } }),
      makeDocTasksAction: async (_p: string, input: unknown) => { calls.push(input); return { success: true, made: 1 }; },
      readGoalsNumbersAction: async () => ({ success: true, label: 'Q4 2026', rows: [{ objective: 'Grow schools', title: 'Paying schools', current: 12, target: 40, unit: null, status: 'on_track' }] }),
    };
  }, opts.made ?? []);
  await openApp(page, 'tests/browser/template-extras.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('call 4: Test plan pass rate from the table; Report a bug on a failed case, with steps and expected', async ({ page }) => {
  await open(page, 'test-plan');
  const s = page.getByTestId('test-plan-summary');
  await expect(s).toContainText('Pass 1 · Fail 1 · Blocked 1 · Not run 0');
  await expect(s).toContainText('33%');
  await s.getByRole('button', { name: 'Report a bug' }).click();
  expect(await calls(page)).toEqual([{ docSlug: 'doc', kind: 'bugs', items: [{ title: 'Expired token', steps: 'Wait, reload', expected: 'Asks again' }] }]);
  expect(await axeViolations(page)).toEqual([]);
});

test('11.8: assumptions show load-bearing, Make a task, and Record a decision on a broken one', async ({ page }) => {
  await open(page, 'assumptions-check', { made: [{ id: 't', title: 'Test: 5 calls', block: 'tpl_tests', done: false, number: 41, assigneeId: null }] });
  const rows = page.getByTestId('assumption-rows').getByRole('listitem');
  await expect(rows.first()).toContainText(/Teachers want it\s*Load-bearing\s*Broken/);
  await expect(rows.nth(1)).toContainText('NB-41');
  await expect(rows.nth(1).getByRole('button', { name: 'Make a task' })).toHaveCount(0);
  await rows.first().getByRole('button', { name: 'Make a task' }).click();
  expect(await calls(page)).toEqual([{ docSlug: 'doc', kind: 'tests', items: [{ title: 'Test: Ask 5 teachers' }] }]);
  await rows.first().getByRole('button', { name: 'Record a decision' }).click();
  await expect(page.getByTestId('record-decision-dialog').getByLabel('Context')).toHaveValue('Assumption broken: Teachers want it');
});

test('20.2: PRD review state, Request review per member, Create roadmap items from Must, Make tasks from stories', async ({ page }) => {
  await open(page, 'prd');
  await expect(page.getByTestId('doc-review-state')).toHaveText('In review · 1 of 2 reviewed');
  const tools = page.getByTestId('prd-tools');
  await tools.getByRole('button', { name: 'Create roadmap items (1)' }).click();
  await tools.getByRole('button', { name: 'Make tasks (1)' }).click();
  await page.getByRole('button', { name: 'Request review' }).click();
  await page.getByLabel('Dev').check();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => calls(page)).toEqual([
    { docSlug: 'doc', kind: 'roadmap', items: [{ title: 'Google SSO' }] },
    { docSlug: 'doc', kind: 'stories', items: [{ title: 'As a teacher I want SSO so that I sign in once' }] },
    { docSlug: 'doc', kind: 'review', items: [{ title: 'Review: PRD – SSO', assigneeId: 'u2' }] },
  ]);
  await page.screenshot({ path: 'test-results/template-extras/prd.png' });
  expect(await axeViolations(page)).toEqual([]);
});

test('call 3: the canvas as nine labelled boxes; goals numbers outside a goals document; phone', async ({ page }) => {
  await open(page, 'bmc');
  const boxes = page.getByTestId('bmc-canvas').getByRole('region');
  await expect(boxes).toHaveCount(9);
  await expect(boxes.nth(3)).toContainText('Value propositions');
  await page.screenshot({ path: 'test-results/template-extras/bmc.png' });
  expect(await axeViolations(page)).toEqual([]);
  await open(page, 'goals', { width: 375 });
  await expect(page.getByTestId('goals-numbers')).toContainText(/Key results · Q4 2026.*Paying schools.*Grow schools.*12 \/ 40/);
  expect(await axeViolations(page)).toEqual([]);
});
