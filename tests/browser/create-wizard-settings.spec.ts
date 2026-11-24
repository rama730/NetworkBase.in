import { expect, test, type Page } from '@playwright/test';
import { buildApp, openApp } from './app-bundle';
import { ENTRY, fillInfo, heading, next } from './create-wizard-helpers';

// Create workspace v6, Task 6: Settings — the section list is docked like /settings (full height at the left edge),
// its highlight follows the scroll, Find filters it, and Reset all brings changed sections back to their defaults.
test.beforeAll(async () => { await buildApp(ENTRY); });
test.use({ viewport: { width: 1440, height: 900 } });

async function openSettings(page: Page) {
    await openApp(page, ENTRY, {
        path: '/workspaces/new',
        beforeGoto: async (p) => { await p.addInitScript(() => { (window as any).__extraActions = { previewWorkspaceSlugAction: () => Promise.resolve(null) }; }); },
    });
    await expect(heading(page, 'What are you starting from?')).toBeVisible();
    await next(page);
    await fillInfo(page);
    await next(page);
    await expect(heading(page, 'Who’s building it?')).toBeVisible();
    await next(page);
    await expect(heading(page, 'How it starts.')).toBeVisible();
}

const dock = (page: Page) => page.locator('[data-settings-dock]');
const scroller = (page: Page) => page.locator('[data-wizard-scroll]');

test('dock is full height at the left edge', async ({ page }) => {
    await openSettings(page);
    const box = await dock(page).boundingBox();
    const area = await scroller(page).boundingBox();
    expect(box!.x).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - area!.height)).toBeLessThanOrEqual(2);
    await scroller(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(200);
    const after = await dock(page).boundingBox();
    expect(Math.abs(after!.y - box!.y)).toBeLessThanOrEqual(1);
});

test('scrolling moves the highlight', async ({ page }) => {
    await openSettings(page);
    const current = dock(page).locator('[aria-current="location"]');
    await expect(current).toContainText('Picture');
    const before = await dock(page).locator('[data-nav-highlight]').evaluate((el) => getComputedStyle(el).transform);
    await scroller(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(current).toContainText('Notifications');
    await page.waitForTimeout(300);
    const after = await dock(page).locator('[data-nav-highlight]').evaluate((el) => getComputedStyle(el).transform);
    expect(after).not.toBe(before);
    await dock(page).getByRole('button', { name: /Links/ }).click();
    await expect(current).toContainText('Links');
});

test('Find filters rows', async ({ page }) => {
    await openSettings(page);
    await expect(dock(page).locator('.nbs-nl')).toHaveCount(8);
    await dock(page).getByRole('searchbox', { name: 'Find a setting' }).fill('notif');
    await expect(dock(page).locator('.nbs-nl')).toHaveCount(1);
    await expect(dock(page).locator('.nbs-nl')).toContainText('Notifications');
    await dock(page).getByRole('searchbox', { name: 'Find a setting' }).fill('zzz');
    await expect(dock(page).getByText('no setting matches')).toBeVisible();
});

test('Reset all appears after a change and restores defaults', async ({ page }) => {
    await openSettings(page);
    await expect(dock(page)).toContainText('00 of 08 changed');
    await expect(dock(page).getByRole('button', { name: 'Reset all' })).toHaveCount(0);
    const posts = page.getByRole('switch', { name: 'Members can post updates' });
    await expect(posts).toHaveAttribute('aria-checked', 'true');
    await posts.click();
    await expect(posts).toHaveAttribute('aria-checked', 'false');
    await expect(dock(page)).toContainText('01 of 08 changed');
    await expect(page.locator('#create-project-launch-permissions')).toContainText('Changed');
    await expect(page.locator('#create-project-launch-permissions').getByRole('button', { name: 'Back to default' })).toBeVisible();
    await page.getByRole('switch', { name: 'Members can edit the doc' }).click();
    await expect(dock(page)).toContainText('02 of 08 changed');
    await dock(page).getByRole('button', { name: 'Reset all' }).click();
    await expect(posts).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('switch', { name: 'Members can edit the doc' })).toHaveAttribute('aria-checked', 'false');
    await expect(dock(page)).toContainText('00 of 08 changed');
});

test('a phone gets a sticky strip of sections instead of the dock column', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openSettings(page);
    const box = await dock(page).boundingBox();
    expect(box!.height).toBeLessThan(120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
