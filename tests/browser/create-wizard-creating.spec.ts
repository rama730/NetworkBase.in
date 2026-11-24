import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { buildApp, openApp } from './app-bundle';
import { ENTRY, fillInfo, heading, next } from './create-wizard-helpers';

// Create workspace v6, Task 8: Creating — one row per real step, each released by the test (gated mock actions), real
// counts, Open now while only the GitHub import is left, and recovery from any step.
test.beforeAll(async () => { await buildApp(ENTRY); });
test.use({ viewport: { width: 1440, height: 900 } });

const ID = '00000000-0000-4000-8000-0000000000aa';
const api = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });

async function open(page: Page, source: 'scratch' | 'github' | 'upload', onSettings?: (page: Page) => Promise<void>) {
    await openApp(page, ENTRY, {
        path: '/workspaces/new',
        beforeGoto: async (p) => {
            await p.route('**/api/v1/github/import/access-state', (r) => r.fulfill(api({ success: true, linked: true, username: 'ada', repoAccess: true, refreshRequired: false, accountHealth: { state: 'ok' } })));
            await p.route('**/api/v1/github/import/repositories**', (r) => r.fulfill(api({ success: true, items: [{ id: 1, owner: 'ada', name: 'garden-map', fullName: 'ada/garden-map', htmlUrl: 'https://github.com/ada/garden-map', private: false, visibility: 'public', defaultBranch: 'main', description: null, updatedAt: null }], cursor: null, hasMore: false })));
            await p.route('**/api/v1/github/import/preflight**', (r) => r.fulfill(api({ success: true, normalizedRepoUrl: 'https://github.com/ada/garden-map', branch: 'main', auth: { source: 'user', installationId: null }, repo: { id: 1, fullName: 'ada/garden-map', visibility: 'public', isPrivate: false, defaultBranch: 'main', sizeKb: 10 }, summary: { rootFiles: 3, rootFolders: 1, ignored: 0, tooLarge: 0 }, warnings: [], metadata: {}, checkedAt: new Date().toISOString() })));
            await p.route('**/api/v1/github/import/branches**', (r) => r.fulfill(api({ success: true, branches: ['main'], authSource: 'user', installationId: null })));
            await p.route('**/api/v1/github/import/analyze**', (r) => r.fulfill(api({ success: true, result: null })));
            await p.route('**/api/v1/github/import/preview-root**', (r) => r.fulfill(api({ success: true, branch: 'main', rootEntries: [], normalizedRepoUrl: 'https://github.com/ada/garden-map', authSource: 'user', installationId: null })));
            await p.addInitScript((id) => {
                const w = window as any;
                w.__gates = {};
                w.__log = [] as string[];
                const gate = (key: string) => new Promise<void>((resolve) => { w.__gates[key] = resolve; });
                w.__hyd = null;
                w.__extraActions = {
                    previewWorkspaceSlugAction: () => Promise.resolve(null),
                    listImportedRepoUrlsAction: () => Promise.resolve({ success: true, repos: [] }),
                    createWorkspaceAction: async () => { w.__log.push('make'); await gate('make'); return { success: true, project: { id, title: 'Garden Map', slug: 'garden-map' } }; },
                    updateWorkspaceDocSettingsAction: async () => { if (w.__failDocPolicy) throw new Error('Failed to fetch'); return { success: true }; },
                    applyCreationIntentAction: async () => { w.__log.push('doc'); await gate('doc'); if (w.__failDoc) { w.__failDoc = false; throw new Error('The doc service is down'); } return { success: true }; },
                    addWorkflowsOnCreateAction: async () => { w.__log.push('workflow'); await gate('workflow'); return { success: true }; },
                    getWorkspaceHydrationProgressAction: async () => { w.__log.push('poll'); return w.__hyd; },
                    // The upload never gets its first upload address, so it stays on the upload row.
                    getBatchUploadUrls: () => new Promise(() => undefined),
                    getUploadPresignedUrl: () => new Promise(() => undefined),
                };
            }, ID);
        },
    });
    await expect(heading(page, 'What are you starting from?')).toBeVisible();
    if (source === 'github') {
        await page.getByRole('tab', { name: /Import from GitHub/ }).click();
        await page.locator('[data-repo-row="ada/garden-map"]').click();
        await expect(page.getByRole('button', { name: /^Continue/ })).toBeEnabled({ timeout: 10_000 });
    }
    if (source === 'upload') {
        await page.getByRole('tab', { name: /Upload files/ }).click();
        const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'nb-creating-')), 'garden-map');
        await mkdir(dir);
        await writeFile(path.join(dir, 'notes.md'), '# Notes\n');
        await page.locator('input[type="file"][webkitdirectory]').setInputFiles(dir);
        await expect(page.locator('[data-start-status]')).toContainText('files', { timeout: 10_000 });
    }
    await next(page);
    if (source === 'github') await page.locator('#create-project-title').fill('');
    await fillInfo(page);
    await next(page);
    await page.locator('[data-popular-roles]').getByRole('button', { name: '+ Frontend developer' }).click();
    await next(page);
    if (onSettings) await onSettings(page);
    await next(page);
    await expect(heading(page, 'Ready to create.')).toBeVisible();
    await page.getByRole('button', { name: /Create workspace/ }).click();
    await expect(page.locator('[data-creating]')).toBeVisible();
}

const row = (page: Page, key: string) => page.locator(`[data-creating] li[data-step="${key}"]`);
const release = async (page: Page, key: string) => {
    await expect.poll(() => page.evaluate((k) => Boolean((window as any).__gates[k]), key)).toBe(true);
    await page.evaluate((k) => (window as any).__gates[k](), key);
};

test('rows tick in order and counts roll', async ({ page }) => {
    await open(page, 'github');
    await expect(page.getByRole('heading', { name: 'Making Garden Map…' })).toBeVisible();
    await expect(row(page, 'make')).toHaveAttribute('data-state', 'current');
    await expect(row(page, 'doc')).toHaveAttribute('data-state', 'pending');
    await release(page, 'make');
    await expect(row(page, 'make')).toHaveAttribute('data-state', 'done');
    await expect(row(page, 'doc')).toHaveAttribute('data-state', 'current');
    await release(page, 'doc');
    await release(page, 'workflow');
    await expect(row(page, 'openings')).toHaveAttribute('data-state', 'done');
    await expect(row(page, 'import')).toHaveAttribute('data-state', 'current');
    await page.evaluate(() => { (window as any).__hyd = { status: 'in_progress', completed: 44, total: 128 }; });
    await expect(row(page, 'import')).toContainText('44 of 128 files', { timeout: 6000 });
    await expect(row(page, 'import')).toContainText('keeps going if you leave');
    expect(await page.evaluate(() => (window as any).__log.filter((x: string) => x !== 'poll'))).toEqual(['make', 'doc', 'workflow']);
});

test('github import last shows Open now; clicking it finishes while import continues', async ({ page }) => {
    await open(page, 'github');
    await expect(page.getByRole('button', { name: 'Open Garden Map now' })).toHaveCount(0);
    for (const key of ['make', 'doc', 'workflow']) await release(page, key);
    await page.evaluate(() => { (window as any).__hyd = { status: 'in_progress', completed: 10, total: 128 }; });
    await page.getByRole('button', { name: 'Open Garden Map now' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__pushed)).toContain(`/created/${ID}`);
    // Nothing asks the server to stop the import.
    expect(await page.evaluate(() => (window as any).__calls.map((c: { name: string }) => c.name).filter((n: string) => /cancel|stop/i.test(n)))).toEqual([]);
});

test('upload never shows Open now', async ({ page }) => {
    await open(page, 'upload');
    for (const key of ['make', 'doc', 'workflow']) await release(page, key);
    await expect(row(page, 'upload')).toHaveAttribute('data-state', 'current');
    await expect(row(page, 'upload')).toContainText('keep this tab open');
    await expect(page.getByText('Keep this tab open until the upload finishes.')).toBeVisible();
    await expect(page.getByRole('button', { name: /now$/ })).toHaveCount(0);
});

test('doc step failure shows Try again and Open anyway; Try again resumes at doc', async ({ page }) => {
    await open(page, 'scratch');
    await page.evaluate(() => { (window as any).__failDoc = true; });
    await release(page, 'make');
    await release(page, 'doc');
    await expect(page.getByRole('heading', { name: 'Garden Map is made. One step didn’t finish.' })).toBeVisible();
    await expect(row(page, 'doc')).toHaveAttribute('data-state', 'failed');
    await expect(row(page, 'doc')).toContainText('The starter doc wasn’t drafted.');
    await expect(page.getByRole('button', { name: 'Open Garden Map anyway' })).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(row(page, 'doc')).toHaveAttribute('data-state', 'current');
    await release(page, 'doc');
    await release(page, 'workflow');
    await expect.poll(() => page.evaluate(() => (window as any).__pushed)).toContain(`/created/${ID}`);
    // Make ran once; the doc ran twice.
    expect(await page.evaluate(() => (window as any).__log.filter((x: string) => x === 'make').length)).toBe(1);
});

test('a GitHub import that finishes reaches Finish on its own', async ({ page }) => {
    await open(page, 'github');
    for (const key of ['make', 'doc', 'workflow']) await release(page, key);
    await page.evaluate(() => { (window as any).__hyd = { status: 'done', completed: 128, total: 128 }; });
    await expect.poll(() => page.evaluate(() => (window as any).__pushed), { timeout: 8000 }).toContain(`/created/${ID}`);
});

test('leaving while Creating keeps no draft of the workspace that was made', async ({ page }) => {
    await open(page, 'scratch');
    await release(page, 'make');
    await expect(row(page, 'doc')).toHaveAttribute('data-state', 'current');
    await page.evaluate(() => (window as any).__router.push('/away'));
    await page.waitForTimeout(800);
    const draft = await page.evaluate(() => new Promise((resolve) => {
        const req = indexedDB.open('keyval-store');
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('keyval')) return resolve(null);
            const get = db.transaction('keyval').objectStore('keyval').get('project_wizard_draft:u1');
            get.onsuccess = () => resolve(get.result ?? null);
            get.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
    }));
    expect(draft).toBeNull();
});

test('Esc and Cancel do nothing while Creating', async ({ page }) => {
    await open(page, 'scratch');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
});

test('a setting that fails after the workspace is made never makes a second one', async ({ page }) => {
    await open(page, 'scratch', async (p) => {
        await p.getByRole('switch', { name: 'Members can edit the doc' }).click();
    });
    await page.evaluate(() => { (window as any).__failDocPolicy = true; });
    await release(page, 'make');
    await release(page, 'doc');
    await release(page, 'workflow');
    await expect.poll(() => page.evaluate(() => (window as any).__pushed)).toContain(`/created/${ID}`);
    expect(await page.evaluate(() => (window as any).__log.filter((x: string) => x === 'make').length)).toBe(1);
});
