import { expect, test, type Page } from '@playwright/test';
import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report H2 (M8, phase H-2): the branch list with New branch; a branch's page with the "On branch" bar, its changes
// against main, its files (view, edit, save), its saves, Update from main with conflicts to choose. Light and dark,
// 1440 and 390 px, no accessibility violations.
const view = (over: Record<string, unknown> = {}) => ({ id: 'b1', name: 'ram/try-header', isDefault: false, status: 'active', createdBy: null, task: null, ahead: 2, behind: 3, changedFiles: 2, stale: false, lastSave: { id: 's2', number: 2, message: 'New header', createdAt: '2026-11-17T09:00:00Z', madeWith: 'with Claude Code' }, createdAt: '2026-11-17T08:00:00Z', updatedAt: '2026-11-17T09:00:00Z', deletedAt: null, ...over });
const MAIN = view({ id: 'm', name: 'main', isDefault: true, ahead: 0, behind: 0, changedFiles: 0, lastSave: null });

async function open(page: Page, { width = 1440, theme = 'light', path = '/', conflicts = false }: { width?: number; theme?: string; path?: string; conflicts?: boolean } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ MAIN, B, conflicts }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    let updated = 0;
    (window as any).__actions = {
      branchesSettingAction: async () => ({ success: true, data: { enabled: true, canChange: true } }),
      listBranchesAction: async (_p: string, status: string) => ({ success: true, data: { branches: status === 'deleted' ? [{ ...B, id: 'b9', name: 'old-idea', status: 'deleted', deletedAt: '2026-11-16T00:00:00Z' }] : [MAIN, B] } }),
      createBranchAction: async (...a: unknown[]) => { calls.push(['create', ...a]); return { success: true, data: { branch: { ...B, id: 'b2', name: a[1], ahead: 0, behind: 0, changedFiles: 0, lastSave: null } } }; },
      branchByNameAction: async (_p: string, name: string) => ({ success: true, data: { branch: name === 'fresh' ? { ...B, name, ahead: 0, behind: 0, changedFiles: 0 } : { ...B, behind: updated ? 0 : 3 } } }),
      branchChangesAction: async () => ({ success: true, data: { files: [{ path: '/README.md', op: 'change', size: 20 }, { path: '/docs/new.md', op: 'add', size: 4 }], truncated: false } }),
      branchDiffAction: async (_b: string, path: string) => ({ success: true, data: { kind: 'text', added: 1, removed: 1, lines: [{ kind: '@', text: '@@ -1 +1 @@' }, { kind: '-', text: 'old' }, { kind: '+', text: `new in ${path}` }] } }),
      branchFilesAction: async () => ({ success: true, data: { files: [{ path: '/README.md', own: true, size: 20, revision: 1000002 }, { path: '/src/app.ts', own: false, size: 9, revision: 1 }], nextCursor: null } }),
      branchFileTextAction: async (_b: string, path: string) => ({ success: true, data: { path, text: `content of ${path}`, size: 20, own: true, contentHash: 'h1', mimeType: 'text/plain' } }),
      saveOnBranchAction: async (...a: unknown[]) => { calls.push(['save', ...a]); return { success: true, data: { save: { id: 's3', number: 3 } } }; },
      branchSavesAction: async () => ({ success: true, data: { saves: [{ id: 's2', number: 2, kind: 'save', message: 'New header', author: { id: 'u', name: 'Ram', username: 'ram' }, madeWith: 'with Claude Code', createdAt: '2026-11-17T09:00:00Z', files: { added: 0, changed: 1, deleted: 0, renamed: 0 } }], nextCursor: null } }),
      updateBranchAction: async (...a: unknown[]) => {
        calls.push(['update', ...a]);
        if (conflicts && !a[1]) return { success: true, data: { upToDate: false, save: null, conflicts: [{ path: '/README.md', kind: 'edit' }] } };
        updated = 1;
        return { success: true, data: { upToDate: false, save: { id: 's4', number: 4 }, conflicts: [] } };
      },
    };
  }, { MAIN, B: view(), conflicts });
  await openApp(page, 'tests/browser/branches.fixture.tsx', { path, head: theme === 'dark' ? "document.documentElement.classList.add('dark')" : '' });
}

test('the list shows main and branches with ahead and behind; New branch creates and opens it', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('button', { name: /ram\/try-header/ })).toContainText('2 saves ahead, 3 behind main');
  await page.getByRole('button', { name: 'New branch' }).click();
  await page.getByLabel('Name').fill('fresh');
  await page.getByRole('button', { name: 'Create branch' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'On branch' })).toContainText('fresh');
  await expect(page.getByRole('status').filter({ hasText: 'On branch' })).toContainText('nothing changed yet');
  expect(page.url()).toContain('branch=fresh');
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls[0]).toEqual(['create', 'p1', 'fresh', 'main']);
});

test('a branch page: the bar, changes against main with a diff, saves, and deleted branches to restore', async ({ page }) => {
  await open(page, { path: '/?branch=ram/try-header' });
  await expect(page.getByRole('status').filter({ hasText: 'On branch' })).toContainText('2 saves ahead, 3 behind main');
  await page.getByRole('navigation', { name: 'Files changed on this branch' }).getByRole('button', { name: /docs\/new\.md/ }).click();
  await expect(page.getByRole('region', { name: 'Diff' })).toContainText('new in /docs/new.md');
  await page.getByRole('tab', { name: /Saves/ }).click();
  await expect(page.getByText('New header')).toBeVisible();
  await page.getByRole('button', { name: 'Branches' }).click();
  await page.getByRole('tab', { name: 'Deleted' }).click();
  await expect(page.getByText('old-idea')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
});

test('edit a file on the branch: opens, edits, saves with the hash it saw', async ({ page }) => {
  await open(page, { path: '/?branch=ram/try-header' });
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.getByRole('button', { name: /\/README\.md/ }).click();
  await expect(page.getByText('content of /README.md')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('File content').fill('# New text');
  await page.getByRole('button', { name: 'Save on ram/try-header' }).click();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__calls)).length).toBe(1);
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls[0]).toEqual(['save', 'b1', { path: '/README.md', text: '# New text', expectedHash: 'h1' }]);
});

test('Update from main: conflicts ask for a choice per file, then update with it', async ({ page }) => {
  await open(page, { path: '/?branch=ram/try-header', conflicts: true });
  await page.getByRole('button', { name: 'Update from main' }).click();
  const region = page.getByRole('region', { name: 'Update conflicts' });
  await expect(region).toContainText('/README.md');
  await region.getByLabel("Keep the branch's").check();
  await region.getByRole('button', { name: 'Update from main' }).click();
  await expect(region).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls.at(-1)).toEqual(['update', 'b1', { '/README.md': 'branch' }]);
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`no accessibility violations: ${theme}, ${width}px`, async ({ page }) => {
      await open(page, { theme, width, path: '/?branch=ram/try-header' });
      await expect(page.getByRole('region', { name: 'Diff' })).toContainText('new in');
      expect(await axeViolations(page)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
