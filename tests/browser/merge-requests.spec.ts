import { expect, test, type Page } from '@playwright/test';
import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report H4 (M8, phase H-3): the merge request list and page: reviewers, checks, the conversation with review
// buttons, files changed with line comments and suggested edits, merge or squash, and conflicts that send you to the
// branch. Light and dark, 1440 and 390 px, no accessibility violations.
const P = (id: string, name: string, username: string) => ({ id, name, username });
const RAM = P('u1', 'Ram', 'ram');
const SAM = P('u2', 'Sam', 'sam');
const summary = { id: 'm1', number: 3, title: 'New header', state: 'open', source: { id: 'b1', name: 'ram/try-header', status: 'active' }, author: RAM, madeWith: 'with Claude Code', task: null, approvals: 0, changesRequested: 0, comments: 2, reviewRequested: true, createdAt: '2026-11-17T08:00:00Z', updatedAt: '2026-11-17T09:00:00Z' };
function detail(over: { state?: string; canReview?: boolean; merged?: boolean; needs?: string[] } = {}) {
  const state = over.state ?? 'open';
  return {
    mergeRequest: {
      id: 'm1', number: 3, title: 'New header', description: '- New header\n- Fix spacing', state, shownState: state,
      source: { id: 'b1', name: 'ram/try-header', status: 'active', headSaveId: 's2' }, target: { id: 'm', name: 'main' },
      author: RAM, madeWith: 'with Claude Code', task: { id: 't4', number: 4, title: 'Header', status: 'in_progress' },
      reviewers: [{ person: SAM, state: 'approved', earlierSave: true }], checks: [{ name: 'build', state: 'passed', url: 'https://ci.example/1', updatedAt: '2026-11-17T09:00:00Z' }],
      merged: over.merged ? { method: 'squash', saveId: 'm9', by: SAM, at: '2026-11-17T10:00:00Z' } : null, behind: 1, bothChanged: [] as string[],
      createdAt: '2026-11-17T08:00:00Z', updatedAt: '2026-11-17T09:00:00Z', closedAt: null,
    },
    saves: [{ id: 's2', number: 2, kind: 'save', message: 'New header', author: RAM, madeWith: null, createdAt: '2026-11-17T09:00:00Z', added: 0, changed: 1, deleted: 0, renamed: 0 }],
    moreSaves: false,
    files: over.merged ? null : { files: [{ path: '/README.md', op: 'change', size: 20 }], truncated: false },
    comments: [
      { id: 'c1', author: SAM, madeWith: null, body: 'Looks good', reviewState: 'approved', path: null, line: null, endLine: null, onEarlierSave: true, suggestion: null, original: null, appliedSaveId: null, resolved: false, createdAt: '2026-11-17T08:30:00Z', mine: false },
      { id: 'c2', author: SAM, madeWith: null, body: 'Shorter?', reviewState: null, path: '/README.md', line: 1, endLine: 1, onEarlierSave: false, suggestion: '# Header', original: '# The new header', appliedSaveId: null, resolved: false, createdAt: '2026-11-17T08:40:00Z', mine: false },
    ],
    events: [{ id: '1', kind: 'opened', actor: RAM, madeWith: 'with Claude Code', data: {}, createdAt: '2026-11-17T08:00:00Z' }],
    viewer: { isAuthor: !over.canReview, canWrite: true, myReview: null, canReview: Boolean(over.canReview), canMerge: state === 'open', canOverride: Boolean(over.needs?.length) },
    protection: { protected: Boolean(over.needs), needs: over.needs ?? [], approvals: { needed: over.needs ? 1 : 0, have: 0 }, checks: [], mergeBy: 'writers' },
  };
}

async function open(page: Page, { width = 1440, theme = 'light', path = '/', canReview = false, conflicts = false, needs }: { width?: number; theme?: string; path?: string; canReview?: boolean; conflicts?: boolean; needs?: string[] } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ summary, D, DM, conflicts }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    let merged = false;
    (window as any).__actions = {
      branchesSettingAction: async () => ({ success: true, data: { enabled: true, canChange: true } }),
      listMergeRequestsAction: async (...a: unknown[]) => { calls.push(['list', ...a]); return { success: true, data: { mergeRequests: a[1] === 'open' ? [summary] : [] } }; },
      getMergeRequestAction: async () => ({ success: true, data: merged ? DM : D }),
      reviewMergeRequestAction: async (...a: unknown[]) => { calls.push(['review', ...a]); return { success: true, data: D }; },
      commentMergeRequestAction: async (...a: unknown[]) => { calls.push(['comment', ...a]); return { success: true, data: { comment: { id: 'c9' } } }; },
      applySuggestionAction: async (...a: unknown[]) => { calls.push(['apply', ...a]); return { success: true, data: { save: { id: 's3', number: 3 } } }; },
      updateMergeRequestAction: async (...a: unknown[]) => { calls.push(['update', ...a]); return { success: true, data: D }; },
      mergeMergeRequestAction: async (...a: unknown[]) => {
        calls.push(['merge', ...a]);
        if (conflicts) return { success: true, data: { outcome: 'conflicts', conflicts: [{ path: '/README.md', kind: 'edit' }] } };
        merged = true;
        return { success: true, data: { outcome: 'merged', method: a[2], save: { id: 'm9', number: 9 }, undoToken: null, task: { number: 4, outcome: 'done' }, branch: { id: 'b1', name: 'ram/try-header' } } };
      },
      branchDiffAction: async (_b: string, path: string) => ({ success: true, data: { kind: 'text', added: 1, removed: 1, lines: [{ kind: '@', text: '@@ -1 +1 @@' }, { kind: '-', text: 'old' }, { kind: '+', text: `new in ${path}` }] } }),
    };
  }, { summary, D: detail({ canReview, needs }), DM: detail({ state: 'merged', merged: true }), conflicts });
  await openApp(page, 'tests/browser/merge-requests.fixture.tsx', { path, head: theme === 'dark' ? "document.documentElement.classList.add('dark')" : '' });
}

test('the list: open ones with your review marked; Waiting on me asks for review-requested', async ({ page }) => {
  await open(page);
  const row = page.getByRole('row').filter({ hasText: '!3 New header' });
  await expect(row).toContainText('ram/try-header');
  await expect(row).toContainText('Your review');
  // Each filter chip has its count; Waiting on me asks the server for review-requested ones.
  await expect.poll(async () => (await page.evaluate(() => (window as any).__calls)).some((c: unknown[]) => c[0] === 'list' && c[3] === true)).toBe(true);
  await expect(page.getByTestId('mr-filter-open')).toContainText('1');
  await page.getByTestId('mr-filter-review').click();
  await page.getByTestId('mr-filter-open').click();
  await page.getByRole('button', { name: /Open merge request !3: New header/ }).click();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('!3 New header');
  expect(page.url()).toContain('mr=3');
});

test('the page: reviewers with "an earlier save", checks, the conversation; a reviewer approves', async ({ page }) => {
  await open(page, { path: '/?mr=3', canReview: true });
  await expect(page.getByText('Approved · earlier save')).toBeVisible();
  await expect(page.getByRole('link', { name: 'build' })).toHaveAttribute('href', 'https://ci.example/1');
  await expect(page.getByText('opened this merge request')).toBeVisible();
  await expect(page.getByText('Looks good')).toBeVisible();
  await page.getByLabel('Comment').fill('Ship it');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__calls)).at(-1)).toEqual(['review', 'p1', 3, 'approve', 'Ship it']);
});

test('files changed: the diff, a suggested edit to apply, and a new line comment with a suggestion', async ({ page }) => {
  await open(page, { path: '/?mr=3' });
  await page.getByRole('tab', { name: /Files changed/ }).click();
  const region = page.getByRole('region', { name: 'Diff and comments' });
  await expect(region).toContainText('new in /README.md');
  await expect(region).toContainText('+ # Header');
  await region.getByRole('button', { name: 'Apply suggestion' }).click();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__calls)).at(-1)).toEqual(['apply', 'p1', 3, 'c2']);
  await region.getByLabel('Line', { exact: true }).fill('2');
  await region.getByLabel('Suggest an edit').check();
  await region.getByLabel('Replacement lines').fill('line two');
  await region.getByRole('button', { name: 'Suggest', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__calls)).at(-1)).toEqual(['comment', 'p1', 3, { body: '', path: '/README.md', line: 2, endLine: 2, suggestion: 'line two' }]);
});

test('merge: squash merges and shows Merged with Revert merge; conflicts send you to update the branch', async ({ page }) => {
  await open(page, { path: '/?mr=3' });
  await page.getByLabel('How to merge').selectOption('squash');
  await page.getByRole('button', { name: 'Squash and merge' }).click();
  await expect(page.getByRole('button', { name: 'Revert merge' })).toBeVisible();
  // Revert merge asks first (design audit F4).
  await page.getByRole('button', { name: 'Revert merge' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Revert the merge of !3?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls.find((c: unknown[]) => c[0] === 'merge')).toEqual(['merge', 'p1', 3, 'squash', false, false]);
});

test('conflicts: "Can\'t merge yet" with the files, and main is left alone', async ({ page }) => {
  await open(page, { path: '/?mr=3', conflicts: true });
  await page.getByRole('button', { name: 'Merge', exact: true }).click();
  const alert = page.getByRole('region', { name: 'Can’t merge yet' });
  await expect(alert).toContainText('/README.md');
  await expect(alert.getByRole('button', { name: 'Update the branch from main' })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`no accessibility violations: ${theme}, ${width}px`, async ({ page }) => {
      await open(page, { theme, width, path: '/?mr=3', canReview: true });
      await expect(page.getByText('Looks good')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      await page.getByRole('tab', { name: /Files changed/ }).click();
      await expect(page.getByRole('region', { name: 'Diff and comments' })).toContainText('new in');
      expect(await axeViolations(page)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `test-results/audit-shots/mr-${theme}-${width}.png` });
    });
  }
}

test('a protected main (H5): the strip says what it needs, Merge waits, and an owner can merge without approval', async ({ page }) => {
  await open(page, { path: '/?mr=3', needs: ['Needs 1 more approval', "Check build hasn't passed"] });
  const strip = page.getByRole('region', { name: 'What main needs' });
  await expect(strip).toContainText('main is protected:');
  await expect(strip).toContainText('Needs 1 more approval');
  await expect(page.getByRole('button', { name: /^Merge$/ })).toBeDisabled();
  await strip.getByRole('button', { name: 'Merge without approval' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Merge without approval' }).click();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__calls)).find((c: unknown[]) => c[0] === 'merge')).toEqual(['merge', expect.anything(), 3, 'merge', false, true]);
});
