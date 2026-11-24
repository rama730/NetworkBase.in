import { expect, test, type Page } from '@playwright/test';
import { buildApp, openApp } from './app-bundle';
import { ENTRY, fillInfo, heading, next } from './create-wizard-helpers';

// Create workspace v6, Task 9: after Create — what was made, Get started with real actions (inline invite to the open
// role, Copy, Hide), the real card, Open replaces the route; and the organization's ready screen.
test.beforeAll(async () => { await buildApp(ENTRY); });
test.use({ viewport: { width: 1440, height: 900 } });

const ID = '00000000-0000-4000-8000-0000000000bb';

async function finish(page: Page) {
    await openApp(page, ENTRY, {
        path: '/workspaces/new',
        beforeGoto: async (p) => {
            await p.addInitScript((id) => {
                const w = window as any;
                w.__invites = [];
                w.__extraActions = {
                    previewWorkspaceSlugAction: () => Promise.resolve(null),
                    createWorkspaceAction: () => Promise.resolve({ success: true, project: { id, title: 'Garden Map', slug: 'garden-map' } }),
                    getWorkspaceInviteOptionsAction: () => Promise.resolve({ success: true, openRoles: [{ id: 'role-1', title: 'Frontend developer', count: 1, filled: 0 }], connections: [] }),
                    searchWorkspaceInviteCandidatesAction: ({ query }: { query: string }) => Promise.resolve({ success: true, items: query.length >= 2 ? [{ id: '00000000-0000-4000-8000-0000000000c1', username: 'sam', fullName: 'Sam Rivera', avatarUrl: null, headline: null }] : [] }),
                    createWorkspaceInvitationAction: (input: unknown) => { w.__invites.push(input); return Promise.resolve({ success: true }); },
                };
            }, ID);
        },
    });
    await expect(heading(page, 'What are you starting from?')).toBeVisible();
    await next(page);
    await fillInfo(page);
    await next(page);
    await page.locator('[data-popular-roles]').getByRole('button', { name: '+ Frontend developer' }).click();
    await next(page);
    await next(page);
    await expect(heading(page, 'Ready to create.')).toBeVisible();
    await page.getByRole('button', { name: /Create workspace/ }).click();
    await expect(heading(page, 'Garden Map is open.')).toBeVisible();
}

test('finish lists what was made', async ({ page }) => {
    await finish(page);
    const made = page.locator('[data-made]');
    for (const text of ['workspace', 'starter doc drafted', 'Roadmap tab', '1 opening on Discover']) await expect(made).toContainText(text);
    await expect(page.locator('[data-finish-side] .nb-project-card h3')).toHaveText('Garden Map');
    await expect(page.locator('[data-finish-side]')).toContainText('networkbase.in/w/garden-map');
    const tasks = page.locator('[data-get-started] [data-task]');
    await expect(tasks.first()).toContainText('Invite people');
    await expect(page.locator('[data-get-started]')).toContainText('Share the Frontend developer opening');
});

test('inline invite searches and invites to the open role', async ({ page }) => {
    await finish(page);
    await page.locator('[data-task="invite"]').getByRole('button', { name: 'Add people' }).click();
    await page.getByRole('textbox', { name: '@handle or name' }).fill('sam');
    await page.getByRole('option', { name: /Sam Rivera/ }).click();
    await expect(page.locator('[data-task="invite"]')).toContainText('Invited @sam. They get a notification.');
    expect(await page.evaluate(() => (window as any).__invites)).toEqual([{ projectId: '00000000-0000-4000-8000-0000000000bb', candidateId: '00000000-0000-4000-8000-0000000000c1', kind: 'ordinary_role', roleId: 'role-1' }]);
    await expect(page.locator('[data-task="invite"]')).toHaveAttribute('data-done', 'true');
});

test('Copy shows Copied then resets', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await finish(page);
    const copy = page.locator('[data-finish-side]').getByRole('button', { name: 'Copy address' });
    await copy.click();
    await expect(page.locator('[data-finish-side]').getByRole('button', { name: 'Copied' })).toBeVisible();
    await expect(copy).toBeVisible({ timeout: 2500 });
});

test('Hide hides here and on Overview', async ({ page }) => {
    await finish(page);
    await page.locator('[data-get-started]').getByRole('button', { name: 'Hide' }).click();
    await expect(page.locator('[data-get-started] [data-task]')).toHaveCount(0);
    await expect(page.getByText('Hidden here and on the Overview.')).toBeVisible();
    expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`nb-get-started:${id}`) ?? '{}').hidden, ID)).toBe(true);
});

test('org finish shows the join code with Copy', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await openApp(page, ENTRY, { path: '/workspaces/new?orgdone=1' });
    await expect(page.getByRole('heading', { name: 'Riverside Robotics Club is ready.' })).toBeVisible();
    await expect(page.getByText('RIV-7K2')).toBeVisible();
    await page.getByRole('button', { name: 'Copy code' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    for (const task of ['Share the join code', 'Make the first workspace', 'Write the welcome doc']) await expect(page.locator('[data-get-started]')).toContainText(task);
    await page.getByRole('button', { name: 'Go to organization' }).click();
    expect(await page.evaluate(() => (window as any).__replaced)).toEqual(['/org/riverside']);
});

test('Open replaces the route', async ({ page }) => {
    await finish(page);
    await page.getByRole('button', { name: 'Open Garden Map' }).click();
    expect(await page.evaluate(() => (window as any).__replaced)).toEqual(['/workspaces/garden-map']);
    expect(await page.evaluate(() => (window as any).__pushed.filter((p: string) => p.startsWith('/workspaces/')))).toEqual([]);
});
