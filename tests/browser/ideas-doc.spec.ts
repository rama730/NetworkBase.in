import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.13 D4 S1–S3, W2–W7 (plan A5.3).
async function open(page: Page, opts: { canAct?: boolean; width?: number } = {}) {
  await page.setViewportSize({ width: opts.width ?? 1100, height: 900 });
  await page.addInitScript(({ canAct }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const idea = (o: Record<string, unknown>) => ({ pitch: null, impact: null, ease: null, confidence: null, stage: 'idea', createdAt: '2027-01-01T00:00:00Z', validation: null, builtAs: null, droppedReason: null, ...o });
    (window as any).__actions = {
      readIdeasAction: async () => ({ success: true, projectKey: 'AC', canAct,
        ranked: [idea({ id: 'i1', number: 40, title: 'Template shop', pitch: 'Sell starter kits', impact: 4, ease: 3, confidence: 2, score: 24, rank: 1, stage: 'validating', validation: { done: 2, total: 3 } }),
          idea({ id: 'i2', number: 41, title: 'Podcast', impact: 2, ease: 2, confidence: 2, score: 8, rank: 2, stage: 'building', builtAs: { id: 'b', number: 320, title: 'Podcast', type: 'project' } }),
          idea({ id: 'i3', number: 42, title: 'Dark mode', score: null, rank: null })],
        dropped: [idea({ id: 'i4', number: 43, title: 'Merch', stage: 'dropped', droppedReason: 'No demand' })] }),
      addIdeaAction: async (_p: string, input: unknown) => { calls.push(['add', input]); return { success: true, id: 'i5', number: 44 }; },
      scoreIdeaAction: async (_p: string, input: unknown) => { calls.push(['score', input]); return { success: true }; },
      validateIdeaAction: async (_p: string, input: unknown) => { calls.push(['validate', input]); return { success: true, steps: 3 }; },
      startBuildingAction: async (_p: string, input: unknown) => { calls.push(['build', input]); return { success: true, builtId: 'n', builtNumber: 321 }; },
      dropIdeaAction: async (_p: string, input: unknown) => { calls.push(['drop', input]); return { success: true }; },
    };
  }, { canAct: opts.canAct ?? true });
  await openApp(page, 'tests/browser/ideas-doc.fixture.tsx');
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('S1: rank, idea and pitch, scores, score in mono, stage in words, validation n of m; unscored last; Dropped folded', async ({ page }) => {
  await open(page);
  const rows = page.getByTestId('idea-row');
  await expect(rows.first()).toContainText(/1\s*Template shop\s*Sell starter kits/);
  await expect(rows.first()).toContainText(/24\s*Validating\s*2 of 3/);
  await expect(rows.nth(1)).toContainText(/Built as AC-320/);
  await expect(rows.nth(2)).toContainText(/–\s*Dark mode.*Not scored\s*Idea/);
  await expect(page.getByTestId('ideas-dropped')).toContainText('Dropped (1)');
  await page.screenshot({ path: 'test-results/ideas-doc/block.png' });
  expect(await axeViolations(page)).toEqual([]);
});

test('W2, W3: + Idea on Enter; picking a score sends it', async ({ page }) => {
  await open(page);
  await page.getByLabel('New idea').fill('Referral program');
  await page.getByLabel('New idea').press('Enter');
  await page.getByLabel('Impact of Dark mode').selectOption('5');
  expect(await calls(page)).toEqual([['add', { docSlug: 'ideas', title: 'Referral program' }], ['score', { taskId: 'i3', impact: 5 }]]);
});

test('W4, W5, W7: Start validating, Start building as a project, Drop with a reason', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Actions for Dark mode' }).click();
  await page.getByRole('menuitem', { name: 'Start validating' }).click();
  await page.getByRole('button', { name: 'Actions for Template shop' }).click();
  await page.getByRole('menuitem', { name: 'Start building…' }).click();
  const b = page.getByTestId('build-idea-dialog');
  await expect(b).toContainText('Idea moves to Building');
  await page.screenshot({ path: 'test-results/ideas-doc/build.png' });
  await b.getByRole('button', { name: /Make a project/ }).click();
  await page.getByRole('button', { name: 'Actions for Podcast' }).click();
  await expect(page.getByRole('menuitem', { name: 'Start building…' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Drop…' }).click();
  const d = page.getByTestId('drop-idea-dialog');
  await d.getByRole('button', { name: 'Drop' }).click();
  await expect(d).toContainText("Say why it's dropped");
  await d.getByLabel('Reason').fill('Too slow to start');
  await d.getByRole('button', { name: 'Drop' }).click();
  expect(await calls(page)).toEqual([['validate', { taskId: 'i3' }], ['build', { taskId: 'i1', as: 'project' }], ['drop', { taskId: 'i2', reason: 'Too slow to start' }]]);
});

test('viewers read: no adds, pickers off, no actions; phone has no accessibility violations', async ({ page }) => {
  await open(page, { canAct: false, width: 375 });
  await expect(page.getByLabel('New idea')).toHaveCount(0);
  await expect(page.getByLabel('Impact of Template shop')).toBeDisabled();
  await expect(page.getByRole('button', { name: /Actions for/ })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});
