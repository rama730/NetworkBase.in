import { expect, test, type Page } from '@playwright/test';
import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report H3 (M8, phase H-1; H-2b: like GitHub's commit list, grouped by day with +/−): History lists saves newest first; a save opens with its files and diffs, the files as
// they were, a zip link and Revert (asked first). Light and dark, 1440 and 390 px, no accessibility violations.
const save = (n: number, extra: Record<string, unknown> = {}) => ({ id: `s${n}`, number: n, kind: 'save', message: `Save message ${n}`, author: { id: 'u1', name: 'Ram', username: 'ram' }, via: null, agentName: null, madeWith: null, task: null, changeSetId: null, revertsSaveId: null, files: { added: 0, changed: 1, deleted: 0, renamed: 0 }, lines: { added: 2, removed: 1 }, createdAt: '2026-11-17T09:00:00Z', ...extra });
const SAVES = [
  save(3, { message: 'Fix the greeting', via: 'agent', agentName: 'Claude Code', madeWith: 'with Claude Code', task: { id: 't4', number: 4, title: 'Greeting' }, lines: { added: 12, removed: 3 }, files: { added: 1, changed: 1, deleted: 0, renamed: 1 } }),
  save(2),
  save(1, { kind: 'start', message: 'Start of history', files: { added: 0, changed: 0, deleted: 0, renamed: 0 }, lines: null, createdAt: '2026-11-16T09:00:00Z' }),
];
const FILES = [
  { path: '/src/hello.ts', fromPath: null, op: 'change', size: 20, mimeType: 'text/plain', version: 2, previousVersion: 1, lines: { added: 5, removed: 2 } },
  { path: '/docs/new.md', fromPath: null, op: 'add', size: 5, mimeType: 'text/markdown', version: 1, previousVersion: null, lines: { added: 1, removed: 0 } },
  { path: '/lib/a.ts', fromPath: '/src/a.ts', op: 'rename', size: 9, mimeType: 'text/plain', version: 1, previousVersion: 1, lines: { added: 0, removed: 0 } },
];

async function open(page: Page, { width = 1440, theme = 'light', path = '/', revert = 'reverted' }: { width?: number; theme?: string; path?: string; revert?: string } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ SAVES, FILES, revert }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      branchesSettingAction: async () => ({ success: true, data: { enabled: true, canChange: true } }),
      listSavesAction: async (_p: string, opts: any) => { calls.push(['list', opts?.path ?? null]); return { success: true, data: { saves: opts?.path ? SAVES.slice(0, 1) : SAVES, nextCursor: null } }; },
      getSaveAction: async (id: string) => ({ success: true, data: { save: SAVES.find((s: any) => s.id === id) ?? SAVES[0], workspaceId: 'p1', files: id === 's1' ? [] : FILES, truncated: false } }),
      saveDiffAction: async (_id: string, path: string) => ({ success: true, data: { kind: 'text', added: 1, removed: 1, lines: [{ kind: '@', text: '@@ -1 +1 @@' }, { kind: '-', text: 'hi' }, { kind: '+', text: `hello from ${path}` }] } }),
      filesAtSaveAction: async () => ({ success: true, data: { saveId: 's3', files: { files: [{ path: '/README.md', nodeId: 'n1', version: 1, size: 10 }, { path: '/src/hello.ts', nodeId: 'n2', version: 2, size: 20 }], nextCursor: null } } }),
      revertSaveAction: async (id: string) => { calls.push(['revert', id]); return { success: true, data: revert === 'reverted' ? { outcome: 'reverted', changeSetId: 'cs9', saveId: 's4' } : { outcome: 'nothing', changeSetId: null, saveId: null } }; },
    };
  }, { SAVES, FILES, revert });
  await openApp(page, 'tests/browser/history.fixture.tsx', { path, head: theme === 'dark' ? "document.documentElement.classList.add('dark')" : '' });
}

test('the list: grouped by day like GitHub, with who, how, the task, +/− and the save number; a path filter asks the server', async ({ page }) => {
  await open(page);
  const today = page.getByRole('region', { name: /^Saves on .*17.*2026$/ });
  await expect(today.getByRole('button').first()).toContainText('Fix the greeting');
  await expect(today.getByRole('button').first()).toContainText('Ram with Claude Code saved');
  await expect(today.getByRole('button').first()).toContainText('#4 Greeting');
  await expect(today.getByRole('button').first().getByLabel('12 lines added, 3 removed')).toBeVisible();
  await expect(today.getByRole('button').first().getByLabel('Save 3')).toBeVisible();
  const before = page.getByRole('region', { name: /^Saves on .*16.*2026$/ });
  await expect(before.getByRole('button')).toContainText('Start');
  await page.getByLabel('Only saves that touched a file or folder').fill('/src');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: /^Saves on/ }).getByRole('button')).toHaveCount(1);
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls).toContainEqual(['list', '/src']);
});

test('a save opens with its files and a diff, browses the files as they were, and has a zip link', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Fix the greeting/ }).click();
  await expect(page.getByRole('heading', { name: 'Fix the greeting' })).toBeVisible();
  expect(page.url()).toContain('save=s3');
  const files = page.getByRole('navigation', { name: 'Files in this save' });
  await expect(files).toContainText('/src/a.ts → /lib/a.ts');
  await expect(files.getByLabel('5 lines added, 2 removed')).toBeVisible();
  await files.getByRole('button', { name: /docs\/new\.md/ }).click();
  await expect(page.getByRole('region', { name: 'Diff' })).toContainText('hello from /docs/new.md');
  await expect(page.getByRole('region', { name: 'Diff' })).toContainText('added line:');
  await expect(page.getByRole('button', { name: 'Download zip' })).toBeEnabled();
  await page.getByRole('button', { name: 'Browse files at this save' }).click();
  await expect(page.getByText('2 files as they were at this save')).toBeVisible();
  await expect(page.getByText('/README.md')).toBeVisible();
});

test('Revert asks first, then reverts and opens the new save', async ({ page }) => {
  await open(page, { path: '/?save=s3' });
  await page.getByRole('button', { name: 'Revert' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Revert “Fix the greeting”?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revert' }).click();
  await expect.poll(() => page.url()).toContain('save=s4');
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls).toContainEqual(['revert', 's3']);
});

test('the start of history has no Revert; viewers see no Revert', async ({ page }) => {
  await open(page, { path: '/?save=s1' });
  await expect(page.getByRole('heading', { name: 'Start of history' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revert' })).toHaveCount(0);
  await open(page, { path: '/?save=s3&viewer=1' });
  await expect(page.getByRole('heading', { name: 'Fix the greeting' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revert' })).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`no accessibility violations: ${theme}, ${width}px`, async ({ page }) => {
      await open(page, { theme, width, path: '/?save=s3' });
      await expect(page.getByRole('heading', { name: 'Fix the greeting' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Diff' })).toContainText('hello from');
      expect(await axeViolations(page)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
