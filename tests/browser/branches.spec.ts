import { expect, test, type Page } from '@playwright/test';
import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report H2 (M8, H-2b: like GitHub): the "main ▾" picker switches the Files tab to a branch. All files then shows the
// branch's folders and files (sidebar tree too), with the "On branch" bar: Compare with main, Update from main,
// Open merge request. On the branch you open, edit, add, upload, rename or move, and delete files; History follows
// the picker. View all branches lists them. Light and dark, 1440 and 390 px, no accessibility violations.
const view = (over: Record<string, unknown> = {}) => ({ id: 'b1', name: 'ram/try-header', isDefault: false, status: 'active', createdBy: { id: 'u1', name: 'Ram', username: 'ram' }, task: null, ahead: 2, behind: 3, changedFiles: 2, stale: false, mergeRequest: null, lastSave: { id: 's2', number: 2, message: 'New header', createdAt: '2026-11-17T09:00:00Z', madeWith: 'with Claude Code' }, createdAt: '2026-11-17T08:00:00Z', updatedAt: '2026-11-17T09:00:00Z', deletedAt: null, ...over });
const MAIN = view({ id: 'm', name: 'main', isDefault: true, ahead: 0, behind: 0, changedFiles: 0, lastSave: null, createdBy: null });
const FOLDERS: Record<string, unknown> = {
  '/': { folder: '/', folders: [{ name: 'src', path: '/src', files: 2 }], files: [{ name: 'README.md', path: '/README.md', own: true, size: 20, mimeType: 'text/markdown', contentHash: 'h1' }] },
  '/src': { folder: '/src', folders: [], files: [{ name: 'app.ts', path: '/src/app.ts', own: false, size: 9, mimeType: 'text/plain', contentHash: 'h2' }, { name: 'logo.png', path: '/src/logo.png', own: false, size: 900, mimeType: 'image/png', contentHash: 'h3' }] },
};

async function open(page: Page, { width = 1440, theme = 'light', path = '/', conflicts = false }: { width?: number; theme?: string; path?: string; conflicts?: boolean } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ MAIN, B, FOLDERS, conflicts }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const ok = (data: unknown) => Promise.resolve({ success: true, data });
    (window as any).__actions = {
      branchesSettingAction: () => ok({ enabled: true, canChange: true }),
      listBranchesAction: (_p: string, status: string) => ok({ branches: status === 'deleted' ? [{ ...B, id: 'b9', name: 'old-idea', status: 'deleted', deletedAt: '2026-11-16T00:00:00Z' }] : [MAIN, { ...B, mergeRequest: { number: 3, state: 'open' } }] }),
      branchByNameAction: (_p: string, name: string) => ok({ branch: { ...B, name } }),
      createBranchAction: (...a: unknown[]) => { calls.push(['create', ...a]); return ok({ branch: { ...B, id: 'b2', name: a[1], ahead: 0, behind: 0, changedFiles: 0, lastSave: null } }); },
      branchFolderAction: (_b: string, folder: string) => { calls.push(['folder', folder]); return ok(FOLDERS[folder || '/'] ?? FOLDERS['/']); },
      branchPathsAction: () => ok({ paths: ['/README.md', '/src/app.ts', '/src/logo.png'] }),
      branchFileTextAction: (_b: string, path: string) => ok({ path, text: path.endsWith('.png') ? null : `line one of ${path}\nline two`, size: 20, own: path === '/README.md', contentHash: 'h1', mimeType: path.endsWith('.png') ? 'image/png' : 'text/plain' }),
      saveOnBranchAction: (...a: unknown[]) => { calls.push(['save', ...a]); return ok({ save: { id: 's3', number: 3 } }); },
      moveOnBranchAction: (...a: unknown[]) => { calls.push(['move', ...a]); return ok({ save: { id: 's4', number: 4 } }); },
      deleteOnBranchAction: (...a: unknown[]) => { calls.push(['delete', ...a]); return ok({ save: { id: 's5', number: 5 } }); },
      beginUploadOnBranchAction: (...a: unknown[]) => { calls.push(['begin', ...a]); return ok({ changeSetId: 'cs1' }); },
      uploadContentOnBranchAction: (...a: unknown[]) => { calls.push(['content', a[0], (a[1] as any).files?.length ?? 0]); return ok({ stored: ['x'], held: [] }); },
      finishUploadOnBranchAction: (...a: unknown[]) => { calls.push(['finish', ...a]); return ok({ save: { id: 's6', number: 6 } }); },
      branchChangesAction: () => ok({ files: [{ path: '/README.md', op: 'change', size: 20 }], truncated: false }),
      branchDiffAction: (_b: string, path: string) => ok({ kind: 'text', added: 1, removed: 1, lines: [{ kind: '@', text: '@@ -1 +1 @@' }, { kind: '-', text: 'old' }, { kind: '+', text: `new in ${path}` }] }),
      updateBranchAction: (...a: unknown[]) => {
        calls.push(['update', ...a]);
        if (conflicts && !a[1]) return ok({ upToDate: false, save: null, conflicts: [{ path: '/README.md', kind: 'edit' }] });
        return ok({ upToDate: false, save: { id: 's7', number: 7 }, conflicts: [] });
      },
      createMergeRequestAction: (...a: unknown[]) => { calls.push(['mr', ...a]); return ok({ mergeRequest: { number: 4 } }); },
      listSavesAction: (_p: string, opts: any) => { calls.push(['saves', opts?.branch ?? null]); return ok({ saves: [], nextCursor: null }); },
    };
  }, { MAIN, B: view(), FOLDERS, conflicts });
  await openApp(page, 'tests/browser/branches.fixture.tsx', { path, head: theme === 'dark' ? "document.documentElement.classList.add('dark')" : '' });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls as unknown[][]);

test('the picker: main ▾ lists branches with ahead, behind and their merge request; picking one switches All files', async ({ page }) => {
  await open(page);
  await expect(page.getByText('Main’s files')).toBeVisible();
  await page.getByRole('button', { name: 'Branch: main. Switch branch' }).click();
  const picker = page.getByRole('dialog', { name: 'Switch branch' });
  await expect(picker.getByRole('button', { name: /ram\/try-header/ })).toContainText('2 saves ahead, 3 behind main');
  await expect(picker.getByRole('button', { name: /ram\/try-header/ })).toContainText('MR !3');
  await picker.getByRole('button', { name: /ram\/try-header/ }).click();
  expect(page.url()).toContain('branch=ram%2Ftry-header');
  await expect(page.getByRole('status', { name: 'On branch' })).toContainText('2 saves ahead, 3 behind main');
  await expect(page.getByRole('button', { name: 'Branch: ram/try-header. Switch branch' })).toBeVisible();
  const files = page.getByRole('table');
  await expect(files).toContainText('README.md');
  await expect(files).toContainText('changed here');
  await files.getByRole('button', { name: 'src', exact: true }).click();
  await expect(files).toContainText('app.ts');
  expect(page.url()).toContain('bpath=%2Fsrc');
  await expect(page.getByRole('tree', { name: /Files on/ })).toContainText('logo.png');
  // b opens the picker.
  await page.keyboard.press('b');
  await expect(page.getByRole('dialog', { name: 'Switch branch' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Switch branch' })).toHaveCount(0);
});

test('New branch from the picker starts from the branch you are on and switches to it', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Switch branch/ }).click();
  await page.getByRole('button', { name: 'New branch' }).click();
  await page.getByLabel('Find or create a branch').fill('ram/fresh');
  await page.getByRole('button', { name: 'Create branch' }).click();
  await expect(page.getByRole('status', { name: 'On branch' })).toContainText('ram/fresh');
  expect((await calls(page)).find((c) => c[0] === 'create')).toEqual(['create', 'p1', 'ram/fresh', 'main']);
});

test('on a branch: open a file with line numbers, edit and save it with the hash it saw; previews an image', async ({ page }) => {
  await open(page, { path: '/?branch=ram/try-header' });
  await page.getByRole('table').getByRole('button', { name: /^README\.md/ }).click();
  await expect(page.getByLabel('Content of /README.md')).toContainText('line one of /README.md');
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('File content').fill('# New text');
  await page.getByRole('button', { name: 'Save on ram/try-header' }).click();
  await expect.poll(async () => (await calls(page)).find((c) => c[0] === 'save')).toEqual(['save', 'b1', { path: '/README.md', text: '# New text', expectedHash: 'h1' }]);
  await page.getByRole('navigation', { name: 'Branch breadcrumb' }).getByRole('button', { name: 'ram/try-header' }).click();
  await page.getByRole('table').getByRole('button', { name: 'src', exact: true }).click();
  await page.getByRole('table').getByRole('button', { name: /^logo\.png/ }).click();
  await expect(page.getByRole('img', { name: 'logo.png' })).toHaveAttribute('src', /raw\?path=%2Fsrc%2Flogo\.png&inline=1/);
});

test('on a branch: new file, rename or move, delete, upload, and find a file by name', async ({ page }) => {
  await open(page, { path: '/?branch=ram/try-header' });
  await page.getByRole('button', { name: 'New file' }).click();
  await page.getByLabel('Name (a/b.md makes folders)').fill('docs/notes.md');
  await page.getByLabel('File content').fill('hello');
  await page.getByRole('button', { name: 'Save on ram/try-header' }).click();
  await expect.poll(async () => (await calls(page)).find((c) => c[0] === 'save')).toEqual(['save', 'b1', { path: '/docs/notes.md', text: 'hello', expectedHash: null }]);
  await page.getByRole('navigation', { name: 'Branch breadcrumb' }).getByRole('button', { name: 'ram/try-header' }).click();
  await page.getByRole('button', { name: 'Actions for README.md' }).click();
  await page.getByRole('menuitem', { name: 'Rename or move' }).click();
  await page.getByLabel(/Rename or move .* to/).fill('/docs/README.md');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await calls(page)).find((c) => c[0] === 'move')).toEqual(['move', 'b1', '/README.md', '/docs/README.md']);
  await page.getByRole('button', { name: 'Actions for src' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).last().click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(async () => (await calls(page)).find((c) => c[0] === 'delete')).toEqual(['delete', 'b1', '/src']);
  await page.locator('input[type=file]:not([webkitdirectory])').setInputFiles({ name: 'up.txt', mimeType: 'text/plain', buffer: Buffer.from('uploaded') });
  await expect.poll(async () => (await calls(page)).find((c) => c[0] === 'finish')).toEqual(['finish', 'cs1', false]);
  const all = await calls(page);
  expect((all.find((c) => c[0] === 'begin') as any)[2][0]).toMatchObject({ path: '/up.txt', size: 8, mimeType: 'text/plain' });
  expect(all.find((c) => c[0] === 'content')).toEqual(['content', 'cs1', 1]);
  await page.getByLabel('Find a file on this branch').fill('app');
  await expect(page.getByRole('list', { name: 'Matching files' })).toContainText('/src/app.ts');
});

test('the bar: Compare with main, Update from main with a choice per file, Open merge request', async ({ page }) => {
  await open(page, { path: '/?branch=ram/try-header', conflicts: true });
  const bar = page.getByRole('status', { name: 'On branch' });
  await bar.getByRole('button', { name: 'Compare with main' }).click();
  await expect(page.getByRole('region', { name: 'Diff' })).toContainText('new in /README.md');
  await bar.getByRole('button', { name: 'Back to files' }).click();
  await bar.getByRole('button', { name: 'Update from main' }).click();
  const region = page.getByRole('region', { name: 'Update conflicts' });
  await region.getByLabel("Keep the branch's").check();
  await region.getByRole('button', { name: 'Update from main' }).click();
  await expect(region).toHaveCount(0);
  expect((await calls(page)).filter((c) => c[0] === 'update').at(-1)).toEqual(['update', 'b1', { '/README.md': 'branch' }]);
  await bar.getByRole('button', { name: 'Open merge request' }).click();
  await page.getByRole('form', { name: 'New merge request' }).getByLabel('Title').fill('New header');
  await page.getByRole('form', { name: 'New merge request' }).getByRole('button', { name: 'Open merge request' }).click();
  await expect.poll(async () => (await calls(page)).find((c) => c[0] === 'mr')).toEqual(['mr', 'p1', { source: 'ram/try-header', title: 'New header', description: null, draft: false }]);
});

test('History follows the picker; View all branches lists them with filters and switches on a click', async ({ page }) => {
  await open(page, { path: '/?branch=ram/try-header' });
  await page.getByRole('button', { name: 'History' }).click();
  await expect.poll(async () => (await calls(page)).find((c) => c[0] === 'saves')).toEqual(['saves', 'ram/try-header']);
  await expect(page.getByRole('status', { name: 'On branch' })).toBeVisible();
  await page.getByRole('button', { name: /Switch branch/ }).click();
  await page.getByRole('button', { name: 'View all branches' }).click();
  await expect(page.getByRole('button', { name: /you’re on it/ })).toContainText('ram/try-header');
  await page.getByRole('tab', { name: 'Deleted' }).click();
  await expect(page.getByText('old-idea')).toBeVisible();
  await page.getByRole('tab', { name: 'Active' }).click();
  await page.getByRole('button', { name: /^main/ }).click();
  await expect(page.getByText('Main’s files')).toBeVisible();
  expect(page.url()).not.toContain('branch=');
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`no accessibility violations: ${theme}, ${width}px`, async ({ page }) => {
      await open(page, { theme, width, path: '/?branch=ram/try-header' });
      await expect(page.getByRole('table')).toContainText('README.md');
      expect(await axeViolations(page)).toEqual([]);
      await page.getByRole('button', { name: /Switch branch/ }).click();
      await expect(page.getByRole('dialog', { name: 'Switch branch' })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
