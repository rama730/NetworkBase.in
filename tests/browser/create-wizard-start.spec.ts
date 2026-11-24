import { expect, test, type Page } from '@playwright/test';
import { buildApp, openApp } from './app-bundle';
import { ENTRY, heading } from './create-wizard-helpers';

// Create workspace v6, Task 3: Start — the workspace tab row, one panel per way in, Lives in as a drop-down.
test.beforeAll(async () => { await buildApp(ENTRY); });
test.use({ viewport: { width: 1440, height: 900 } });

const REPOS = [
    { id: 1, owner: 'ada', name: 'garden-map', fullName: 'ada/garden-map', htmlUrl: 'https://github.com/ada/garden-map', private: true, visibility: 'private', defaultBranch: 'main', description: 'Plots on a map', updatedAt: '2026-11-22T10:00:00Z' },
    { id: 2, owner: 'ada', name: 'seed-swap', fullName: 'ada/seed-swap', htmlUrl: 'https://github.com/ada/seed-swap', private: false, visibility: 'public', defaultBranch: 'main', description: null, updatedAt: '2026-09-01T10:00:00Z' },
];
async function open(page: Page, query = '') {
    await openApp(page, ENTRY, {
        path: `/workspaces/new${query}`,
        beforeGoto: async (p) => {
            await p.route('**/api/v1/github/import/access-state', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { success: true, linked: true, username: 'ada', repoAccess: true, refreshRequired: false, accountHealth: { state: 'ok' } } }) }));
            await p.route('**/api/v1/github/import/repositories**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { success: true, items: REPOS, cursor: null, hasMore: false } }) }));
            await p.addInitScript(() => { (window as any).__extraActions = { listImportedRepoUrlsAction: () => Promise.resolve({ success: true, repos: [{ url: 'https://github.com/ada/seed-swap', title: 'Seed Swap', slug: 'seed-swap' }] }) }; });
        },
    });
    await expect(heading(page, 'What are you starting from?')).toBeVisible();
}
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name });

test('the four ways in are one tab row and each opens its own panel', async ({ page }) => {
    await open(page);
    await expect(tab(page, /Start from scratch/)).toHaveAttribute('aria-selected', 'true');
    await expect(heading(page, 'Set up the workspace in the next steps')).toBeVisible();
    await expect(page.getByText('Comes with')).toBeVisible();
    await tab(page, /Upload files/).click();
    await expect(heading(page, 'Choose a folder on this device')).toBeVisible();
    await tab(page, /Create organization/).click();
    await expect(heading(page, 'What kind of organization?')).toBeVisible();
    // The summary on the right keeps the same parts for every way in.
    await expect(page.locator('[data-start-summary]')).toContainText('Next');
});

test('Lives in is a drop-down at the end of the tab row', async ({ page }) => {
    await open(page, '?org=1');
    await page.getByRole('button', { name: /^Lives in/ }).click();
    await page.getByRole('option', { name: /Riverside Robotics Club/ }).click();
    await expect(page.getByRole('button', { name: /^Lives in/ })).toContainText('Riverside Robotics Club');
    await expect(page.locator('[data-start-summary]')).toContainText('Riverside Robotics Club');
    await tab(page, /Create organization/).count().then((n) => expect(n).toBe(0));
});

test('opened from the club page, Lives in is locked and says so', async ({ page }) => {
    await open(page, '?org=1&locked=1');
    await expect(page.getByText(/Set by Riverside Robotics Club/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Lives in/ })).toHaveCount(0);
});

test('a repository that is already a workspace says so instead of Import', async ({ page }) => {
    await open(page);
    await tab(page, /Import from GitHub/).click();
    await expect(page.getByText('ada/seed-swap')).toBeVisible();
    await expect(page.locator('[data-repo-row="ada/seed-swap"]')).toContainText('Already a workspace');
    await expect(page.locator('[data-repo-row="ada/garden-map"]')).not.toContainText('Already a workspace');
});

test('dragging a folder over the drop zone says it will read it', async ({ page }) => {
    await open(page);
    await tab(page, /Upload files/).click();
    const zone = page.locator('[data-drop-zone]');
    await zone.dispatchEvent('dragover', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
    await expect(zone).toHaveAttribute('data-over', 'true');
    await expect(zone).toContainText('Drop to read this folder');
});

test('Start opens on the last way in, and says so', async ({ page }) => {
    await open(page);
    await tab(page, /Upload files/).click();
    await page.reload();
    await expect(tab(page, /Upload files/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('opened on your last choice')).toBeVisible();
});

test('a GitHub hand-off (initial source) wins over the last way in', async ({ page }) => {
    await open(page);
    await tab(page, /Upload files/).click();
    await page.goto(page.url().replace(/\/workspaces\/new.*/, '/workspaces/new?source=github'));
    await expect(tab(page, /Import from GitHub/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('opened on your last choice')).toHaveCount(0);
});
