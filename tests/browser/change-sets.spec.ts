import { expect, test, type Page } from '@playwright/test';
import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report G12 (M5): review a change set, apply it in one step, undo it; empty states say what to do next.
const SET = { id: 'cs1', title: 'Redesign sign-in', message: 'New layout and copy', status: 'ready', taskId: 't1', filesAdded: 1, filesChanged: 2, filesDeleted: 1, filesRenamed: 0, linesAdded: 12, linesRemoved: 4, updatedAt: '2026-11-16T10:42:00Z', readyAt: '2026-11-16T10:42:00Z', createdAt: '2026-11-16T10:00:00Z', madeWith: 'with Claude Code' };
const ITEMS = [
  { id: 'i1', op: 'add', path: '/app/login/page.tsx', fromPath: null, state: 'ready', linesAdded: 10, linesRemoved: 0, conflict: null },
  { id: 'i2', op: 'change', path: '/app/globals.css', fromPath: null, state: 'ready', linesAdded: 2, linesRemoved: 1, conflict: null },
  { id: 'i3', op: 'change', path: '/README.md', fromPath: null, state: 'ready', linesAdded: 0, linesRemoved: 3, conflict: null },
  { id: 'i4', op: 'delete', path: '/app/old-login.tsx', fromPath: null, state: 'ready', linesAdded: null, linesRemoved: null, conflict: null },
];

async function open(page: Page, { sets = [SET], enabled = true, width = 1440, theme = 'light', path = '/', items = ITEMS, stepUp = false }: { sets?: unknown[]; enabled?: boolean; width?: number; theme?: string; path?: string; items?: unknown[]; stepUp?: boolean } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ sets, enabled, items, stepUp }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    let status = 'ready';
    (window as any).__actions = {
      listChangeSetsAction: async () => ({ success: true, data: { enabled, changeSets: sets.map((s: any) => ({ ...s, status })), nextCursor: null } }),
      getChangeSetAction: async () => ({ success: true, data: { changeSet: { ...(sets[0] as any), status }, items, overlaps: [{ id: 'cs2', title: 'Codex cleanup', agent: 'Codex', files: 2 }] } }),
      addChangeSetCommentAction: async (...a: unknown[]) => { calls.push(['comment', ...a]); return { success: true, data: {} }; },
      openChangeSetsForAction: async () => ({ success: true, data: [{ id: 'cs1', title: 'Redesign sign-in', status: 'ready', agent: 'Claude Code', files: 4 }] }),
      changeSetDiffAction: async (_id: string, path: string) => ({ success: true, data: path.endsWith('.css')
        ? { kind: 'text', added: 2, removed: 1, lines: [{ kind: '@', text: '@@ -1 +1 @@' }, { kind: '-', text: 'body { color: red }' }, { kind: '+', text: 'body { color: #141A1E }' }, { kind: '+', text: 'main { gap: 8px }' }] }
        : { kind: 'text', added: 1, removed: 0, lines: [{ kind: '@', text: '@@ -0 +1 @@' }, { kind: '+', text: `// ${path}` }] } }),
      applyChangeSetAction: async (...a: unknown[]) => {
        calls.push(['apply', ...a]);
        if (stepUp && calls.filter((c: any) => c[0] === 'apply').length === 1) return { success: false, code: 'STEP_UP_REQUIRED', error: 'Verify it’s you first', stepUp: { methods: ['password'] } };
        status = 'applied'; return { success: true, data: { changeSet: { ...(sets[0] as any), status } } };
      },
      undoChangeSetAction: async (...a: unknown[]) => { calls.push(['undo', ...a]); status = 'undone'; return { success: true, data: {} }; },
      discardChangeSetAction: async (...a: unknown[]) => { calls.push(['discard', ...a]); status = 'discarded'; return { success: true, data: {} }; },
      askForChangesAction: async (...a: unknown[]) => { calls.push(['ask', ...a]); return { success: true, data: { ok: true } }; },
      updateDraftAction: async (...a: unknown[]) => { calls.push(['update', ...a]); return { success: true, data: { merged: [], conflicts: [] } }; },
      conflictSidesAction: async (_id: string, path: string) => ({ success: true, data: { path, kind: 'edit', base: 'a\nb\n', theirs: 'a\nTHEIRS\n', mine: 'a\nMINE\n' } }),
      resolveItemAction: async (...a: unknown[]) => { calls.push(['resolve', ...a]); return { success: true, data: { item: null } }; },
    };
  }, { sets, enabled, items, stepUp });
  await openApp(page, 'tests/browser/change-sets.fixture.tsx', { path, head: theme === 'dark' ? "document.documentElement.classList.add('dark')" : '' });
}

test('the list shows what is waiting; a set opens with its files grouped and a diff', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Redesign sign-in/ }).click();
  await expect(page.getByRole('heading', { name: 'Redesign sign-in' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Ready');
  const files = page.getByRole('navigation', { name: 'Files in this change set' });
  await expect(files.getByText('Added (1)')).toBeVisible();
  await expect(files.getByText('Changed (2)')).toBeVisible();
  await expect(files.getByText('Deleted (1)')).toBeVisible();
  await files.getByRole('button', { name: '/app/globals.css' }).click();
  await expect(page.getByRole('region', { name: 'Diff' })).toContainText('main { gap: 8px }');
  expect(page.url()).toContain('changes=cs1');
});

test('j and k move between files', async ({ page }) => {
  await open(page, { path: '/?changes=cs1' });
  const diff = page.getByRole('region', { name: 'Diff' });
  await expect(diff).toContainText('/app/login/page.tsx');
  await page.keyboard.press('j');
  await expect(diff).toContainText('main { gap: 8px }');
  await page.keyboard.press('k');
  await expect(diff).toContainText('/app/login/page.tsx');
});

test('apply in one step, then undo with a named confirmation', async ({ page }) => {
  await open(page, { path: '/?changes=cs1' });
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Undo “Redesign sign-in”?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Copy as new draft' })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls.map((c: unknown[]) => c[0])).toEqual(['apply', 'undo']);
});

test('apply only the selected files', async ({ page }) => {
  await open(page, { path: '/?changes=cs1' });
  await page.getByRole('checkbox', { name: 'Apply only /app/globals.css' }).check();
  await page.getByRole('button', { name: 'Apply 1 selected' }).click();
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls[0]).toEqual(['apply', 'cs1', ['/app/globals.css']]);
});

test('ask for changes leaves a note for the agent', async ({ page }) => {
  await open(page, { path: '/?changes=cs1' });
  await page.getByRole('button', { name: 'Ask for changes' }).click();
  await page.getByLabel('What should change').fill('Keep the old logo');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toEqual([['ask', 'cs1', 'Keep the old logo']]);
});

test('empty states say what to do: nothing waiting gives a copyable command; off says so', async ({ page }) => {
  await open(page, { sets: [] });
  await expect(page.getByText('Nothing waiting for review')).toBeVisible();
  await expect(page.getByRole('button', { name: /Copy nb change start/ })).toBeVisible();
  await page.close();
});

test('change sets off: the view says so', async ({ page }) => {
  await open(page, { enabled: false });
  await expect(page.getByText('Change sets aren’t on for this workspace yet')).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`no accessibility violations, ${theme}, ${width}px`, async ({ page }) => {
      await open(page, { path: '/?changes=cs1', theme, width });
      await expect(page.getByRole('heading', { name: 'Redesign sign-in' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Diff' })).toContainText('@@');
      expect(await axeViolations(page)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}

const CONFLICTED = [{ id: 'c1', op: 'change', path: '/app/page.tsx', fromPath: null, state: 'conflict', linesAdded: 1, linesRemoved: 1, conflict: { kind: 'edit' } }];

test('a conflicted file opens the merge editor: base, theirs and yours; keep one or edit the result', async ({ page }) => {
  await open(page, { path: '/?changes=cs1', items: CONFLICTED });
  await expect(page.getByRole('status').filter({ hasText: 'changed since' })).toBeVisible();
  const diff = page.getByRole('region', { name: 'Diff' });
  await expect(diff.getByText('Someone changed the same lines')).toBeVisible();
  await expect(diff.getByText('Theirs (now in the workspace)')).toBeVisible();
  await expect(diff.getByText('MINE')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await diff.getByRole('button', { name: 'Edit the result' }).click();
  await page.getByLabel('The result').fill('a\nBOTH\n');
  await diff.getByRole('button', { name: 'Use this result' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toEqual([['resolve', 'cs1', '/app/page.tsx', 'content', 'a\nBOTH\n']]);
});

test('Update brings in the latest files', async ({ page }) => {
  await open(page, { path: '/?changes=cs1' });
  await page.getByRole('button', { name: 'Update' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toEqual([['update', 'cs1']]);
});

test('the merge editor has no accessibility violations, dark, 390px', async ({ page }) => {
  await open(page, { path: '/?changes=cs1', items: CONFLICTED, theme: 'dark', width: 390 });
  await expect(page.getByRole('region', { name: 'Diff' }).getByText('MINE')).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test('final files or a doc: Apply asks "Verify it’s you" first', async ({ page }) => {
  await open(page, { path: '/?changes=cs1', stepUp: true });
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Verify it’s you');
  await expect(dialog).toContainText('final files or a doc');
});

test('the workspace header links to change sets ready for review', async ({ page }) => {
  await open(page);
  const link = page.getByRole('banner', { name: 'Workspace header' }).getByRole('link', { name: '1 change set ready' });
  await expect(link).toHaveAttribute('href', '/workspaces/ponytail?tab=files&filesView=changes');
});

test('presence: the task says an agent is changing files, and the set names drafts that share files', async ({ page }) => {
  await open(page, { path: '/?changes=cs1' });
  const task = page.getByRole('region', { name: 'Task presence' });
  await expect(task).toContainText('Claude Code is changing 4 files for this task');
  await expect(task.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/workspaces/ponytail?tab=files&filesView=changes&changes=cs1');
  await expect(page.getByText('Codex also has a draft on 2 of these files')).toBeVisible();
});

test('line comments: click a line number, write, send; an unsent comment survives a reload', async ({ page }) => {
  await open(page, { path: '/?changes=cs1' });
  const diff = page.getByRole('region', { name: 'Diff' });
  await page.getByRole('navigation', { name: 'Files in this change set' }).getByRole('button', { name: '/app/globals.css' }).click();
  await diff.getByRole('button', { name: 'Comment on line 2' }).click();
  await expect(diff.getByText('Comment on line 2')).toBeVisible();
  await diff.getByRole('textbox').fill('Use the brand token here');
  await page.reload();
  await page.getByRole('navigation', { name: 'Files in this change set' }).getByRole('button', { name: '/app/globals.css' }).click();
  await expect(diff.getByRole('textbox')).toHaveValue('Use the brand token here');
  await diff.getByRole('button', { name: 'Comment on line 1' }).click();
  await diff.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toEqual([['comment', 'cs1', { path: '/app/globals.css', line: 1, body: 'Use the brand token here' }]]);
});
