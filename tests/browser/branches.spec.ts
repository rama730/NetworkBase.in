import { expect, test, type Page } from '@playwright/test';
import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report H2 (M8, H-2b: like GitHub): the "main ▾" picker switches the Files tab to a branch. All files then shows the
// branch's folders and files (sidebar tree too), with the "On branch" bar: Compare with main, Update from main,
// Open merge request. On the branch you open, edit, add, upload, rename or move, and delete files; History follows
// the picker. View all branches lists them. Design audit (17 Nov 2026): the app's menu, header breadcrumb and grid.
// Light and dark, 1440 and 390 px, no accessibility violations.
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
      branchByNameAction: (_p: string, name: string) => ok({ branch: (window as any).__deletedBranch ? { ...B, id: 'b9', name, status: 'deleted', deletedAt: new Date(Date.now() - 86_400_000).toISOString() } : { ...B, id: (window as any).__made?.[name] ?? B.id, name } }),
      restoreBranchAction: (...a: unknown[]) => { calls.push(['restore', ...a]); return ok({ branch: B }); },
      createBranchAction: (...a: unknown[]) => { calls.push(['create', ...a]); ((window as any).__made ??= {})[a[1] as string] = 'b2'; return ok({ branch: { ...B, id: 'b2', name: a[1], ahead: 0, behind: 0, changedFiles: 0, lastSave: null } }); },
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
const picker = (page: Page) => page.getByRole('dialog', { name: 'Switch branch' });

test('the picker: main ▾ is the app’s menu, lists branches with ahead, behind and MR; picking one switches All files', async ({ page }) => {
  await open(page);
  await expect(page.getByText('Main’s files')).toBeVisible();
  await page.getByRole('button', { name: 'Branch: main. Switch branch' }).click();
  const item = picker(page).getByRole('menuitem', { name: /ram\/try-header/ });
  await expect(item).toContainText('2 saves ahead, 3 behind main');
  await expect(item).toContainText('MR !3');
  await item.click();
  expect(page.url()).toContain('branch=ram%2Ftry-header');
  await expect(page.getByRole('status', { name: 'On branch' })).toContainText('2 saves ahead, 3 behind main');
  await expect(page.getByRole('navigation', { name: 'Branch breadcrumb' })).toContainText('ram/try-header');
  await expect(page.getByRole('button', { name: 'Open README.md' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'README.md' })).toContainText('Changed');
  await page.getByRole('button', { name: 'Open folder src' }).click();
  await expect(page.getByRole('button', { name: 'Open app.ts' })).toBeVisible();
  expect(page.url()).toContain('bpath=%2Fsrc');
  await expect(page.getByRole('navigation', { name: 'Branch breadcrumb' })).toContainText('src');
  await expect(page.getByRole('tree', { name: /Files on/ })).toContainText('logo.png');
  // b opens the picker.
  await page.locator('body').click({ position: { x: 5, y: 600 } });
  await page.keyboard.press('b');
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker(page)).toHaveCount(0);
});

test('New branch from the picker starts from the branch you are on and switches to it', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Switch branch/ }).click();
  await picker(page).getByRole('menuitem', { name: 'New branch…' }).click();
  await page.getByLabel('Find or create a branch').fill('ram/fresh');
  await page.getByRole('button', { name: 'Create branch' }).click();
  await expect(page.getByRole('status', { name: 'On branch' })).toContainText('ram/fresh');
  expect((await calls(page)).find((c) => c[0] === 'create')).toEqual(['create', 'p1', 'ram/fresh', 'main']);
});

test('on a branch: a file opens in the app’s viewer; edit and save it with the hash it saw; previews an image', async ({ page }) => {
  await open(page, { path: '/?branch=ram/try-header' });
  await page.getByRole('button', { name: 'Open README.md' }).click();
  await expect(page.getByText('line one of /README.md')).toBeVisible();
  await expect(page.getByText('Changed here')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('group', { name: 'File content' }).locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('# New text');
  await page.getByRole('button', { name: 'Save on ram/try-header' }).click();
  await expect.poll(async () => (await calls(page)).find((c) => c[0] === 'save')).toEqual(['save', 'b1', { path: '/README.md', text: '# New text', expectedHash: 'h1' }]);
  await page.getByRole('navigation', { name: 'Branch breadcrumb' }).getByRole('button', { name: 'ram/try-header' }).click();
  await page.getByRole('button', { name: 'Open folder src' }).click();
  await page.getByRole('button', { name: 'Open logo.png' }).click();
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
  await expect(page.getByRole('rowgroup', { name: 'Matching files' })).toContainText('app.ts');
});

test('the strip: Compare with main (pressed), Update from main with a choice per file, Open merge request', async ({ page }) => {
  await open(page, { path: '/?branch=ram/try-header', conflicts: true });
  const bar = page.getByRole('status', { name: 'On branch' });
  await bar.getByRole('button', { name: 'Compare with main' }).click();
  await expect(bar.getByRole('button', { name: 'Compare with main' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('navigation', { name: 'Branch breadcrumb' })).toContainText('Compare with main');
  await expect(page.getByRole('region', { name: 'Diff' })).toContainText('new in /README.md');
  await bar.getByRole('button', { name: 'Compare with main' }).click();
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

test('History follows the picker; View all branches lists them with filter chips and switches on a click', async ({ page }) => {
  await open(page, { path: '/?branch=ram/try-header' });
  await page.getByRole('button', { name: 'History' }).click();
  await expect.poll(async () => (await calls(page)).find((c) => c[0] === 'saves')).toEqual(['saves', 'ram/try-header']);
  await expect(page.getByRole('status', { name: 'On branch' })).toBeVisible();
  await page.getByRole('button', { name: /Switch branch/ }).click();
  await picker(page).getByRole('menuitem', { name: 'View all branches' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'ram/try-header' })).toContainText('You’re on it');
  await page.getByTestId('branches-filter-deleted').click();
  await expect(page.getByText('old-idea')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
  await page.getByTestId('branches-filter-active').click();
  await page.getByRole('button', { name: 'Switch to main' }).click();
  await expect(page.getByText('Main’s files')).toBeVisible();
  expect(page.url()).not.toContain('branch=');
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`no accessibility violations: ${theme}, ${width}px`, async ({ page }) => {
      await open(page, { theme, width, path: '/?branch=ram/try-header' });
      await expect(page.getByRole('button', { name: 'Open README.md' })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      await page.getByRole('button', { name: /Switch branch/ }).click();
      await expect(picker(page)).toBeVisible();
      // The menu fades in; checking contrast mid-fade measures half-transparent text.
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
      expect(await axeViolations(page)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `test-results/audit-shots/branches-${theme}-${width}.png` });
    });
  }
}

// M9 B1 (0.8 #3, #4, #8, #11; H23): the first-time New dot and one line, keys, skeletons, and an unsaved edit kept.
test('the picker shows a New dot until first opened, and that first time says what branches are', async ({ page }) => {
  await open(page);
  const button = page.getByRole('button', { name: 'Branch: main. Switch branch' });
  await expect(button.getByRole('img', { name: 'New' })).toBeVisible();
  await button.click();
  await expect(picker(page)).toContainText('Branches let you try changes without touching main. Merge when you’re happy.');
  await page.keyboard.press('Escape');
  await expect(button.getByRole('img', { name: 'New' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Branch: main. Switch branch' }).getByRole('img', { name: 'New' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Branch: main. Switch branch' }).click();
  await expect(picker(page)).not.toContainText('Branches let you try changes');
});

test('keys on Files: ? lists them, / searches, b opens the branch picker', async ({ page }) => {
  await open(page, { path: '/?branch=ram/try-header' });
  await expect(page.getByRole('button', { name: 'Open README.md' })).toBeVisible();
  await page.keyboard.press('?');
  const keys = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(keys).toContainText('Search this view');
  await expect(keys).toContainText('Switch branch');
  await page.keyboard.press('Escape');
  await expect(keys).toHaveCount(0);
  // On a branch, / searches the branch's files (H8), not main's.
  await page.keyboard.press('/');
  await expect(page.locator('#branch-name-search')).toBeFocused();
  await page.locator('#branch-name-search').blur();
  await page.keyboard.press('b');
  await expect(picker(page)).toBeVisible();
});

test('an unsaved edit on a branch is kept when you leave the file, and comes back when you open it again', async ({ page }) => {
  await open(page, { path: '/?branch=ram/try-header' });
  await page.getByRole('button', { name: 'Open README.md' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('group', { name: 'File content' }).locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('# Not saved yet');
  await page.getByRole('button', { name: 'History' }).click();
  await page.getByRole('button', { name: 'All files' }).click();
  const back = page.getByRole('button', { name: 'Open README.md' });
  if (await back.isVisible()) await back.click();
  await expect(page.getByRole('group', { name: 'File content' }).locator('.cm-content')).toContainText('# Not saved yet');
  await page.getByRole('button', { name: 'Save on ram/try-header' }).click();
  await expect.poll(async () => (await calls(page)).find((c) => c[0] === 'save')).toEqual(['save', 'b1', { path: '/README.md', text: '# Not saved yet', expectedHash: 'h1' }]);
});

test('0.8 #1, #7: an empty History says so on the branch; Delete names the branch and the saves not in main', async ({ page }) => {
  await open(page, { path: '/?branch=ram/try-header' });
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText('No saves on ram/try-header yet')).toBeVisible();
  await page.getByRole('button', { name: 'All files' }).click();
  await page.getByRole('button', { name: 'More for ram/try-header' }).click();
  await page.getByRole('menuitem', { name: 'Delete branch' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete ram/try-header?' });
  await expect(confirm).toContainText("2 saves aren't in main.");
  await expect(confirm).toContainText('You can restore it for 30 days.');
});

test('H5, H24: an upload on a protected main is offered a new branch; the files go there', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('nb:protected-upload', { detail: { projectId: 'p1', files: [new File(['hello\n'], 'notes.txt', { type: 'text/plain' })], folder: '/' } })));
  const offer = page.getByRole('alertdialog', { name: 'main is protected. Upload to a new branch?' });
  await expect(offer).toContainText('The file goes on a new branch');
  await offer.getByLabel('Branch name').fill('ram/upload');
  await offer.getByRole('button', { name: 'Upload to branch' }).click();
  await expect.poll(async () => (await calls(page)).find((c) => c[0] === 'create')).toEqual(['create', 'p1', 'ram/upload', 'main']);
  await expect.poll(async () => (await calls(page)).find((c) => c[0] === 'begin')?.[2]).toEqual([expect.objectContaining({ path: '/notes.txt', size: 6 })]);
  await expect.poll(async () => (await calls(page)).some((c) => c[0] === 'finish')).toBe(true);
});

test('H24: an old link to a deleted branch says when, with Restore and Go to main', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__deletedBranch = true; });
  await open(page, { path: '/?branch=old-idea' });
  await expect(page.getByText(/This branch was deleted on/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
  await page.getByRole('button', { name: 'Go to main' }).click();
  await expect(page.getByText('Main’s files')).toBeVisible();
});
