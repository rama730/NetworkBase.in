import { expect, test, type Page } from '@playwright/test';
import { buildApp } from './app-bundle';
import { ENTRY, fillInfo, heading, next, openWizard as open } from './create-wizard-helpers';

// Create workspace v6, Task 2: the shell — one sliding step marker, fix counts, footer keys, Back to Review, draft safety.
test.beforeAll(async () => { await buildApp(ENTRY); });
test.use({ viewport: { width: 1440, height: 900 } });

const marker = (page: Page) => page.locator('[data-step-marker]').evaluate((el) => (el as HTMLElement).style.transform);

test('the step marker moves to Info after Continue', async ({ page }) => {
    await open(page);
    const before = await marker(page);
    await next(page);
    await expect(heading(page, 'Name it, then explain it.')).toBeVisible();
    await expect.poll(() => marker(page)).not.toBe(before);
});

test('a step left with problems shows how many to fix and loses its tick', async ({ page }) => {
    await open(page);
    await next(page);
    await next(page); // blocked: Info is empty
    await page.getByRole('button', { name: /^Start, done/ }).click();
    await expect(page.locator('[data-step="2"] [data-fix-count]')).toHaveText(/^[1-9] to fix$/);
});

test('leaving Review comes back with Back to Review', async ({ page }) => {
    await open(page);
    await next(page);
    await fillInfo(page);
    for (let i = 0; i < 3; i++) await next(page);
    await expect(heading(page, /Ready to create|Almost there/)).toBeVisible();
    // Leaving Review by its step strip (or its Edit buttons, Task 7) comes back with Back to Review.
    await page.getByRole('button', { name: /^Info, done/ }).click();
    await page.getByRole('button', { name: /^Back to Review/ }).click();
    await expect(heading(page, /Ready to create|Almost there/)).toBeVisible();
    // Back to Review never presses Create (the footer button used to turn into the submit under the click).
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__calls.filter((c: { name: string }) => c.name === 'createWorkspaceAction').length)).toBe(0);
});

test('Cmd+Enter continues; Esc in a text field does nothing; Esc on the page opens Leave', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Meta+Enter');
    await expect(heading(page, 'Name it, then explain it.')).toBeVisible();
    await page.locator('#create-project-title').fill('Garden');
    await page.locator('#create-project-title').press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('[data-phase-heading]').click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
});

test('the footer says Saved and shows the keys, with no Save now', async ({ page }) => {
    await open(page);
    const footer = page.locator('footer.nb-wizard-footer');
    await expect(footer).toContainText('↵');
    await expect(footer).toContainText('Esc');
    await expect(footer).toContainText(/Saves on this device as you go|Saved/);
    await expect(footer.getByRole('button', { name: 'Save now' })).toHaveCount(0);
});

test('a draft never stores the Back to Review state', async ({ page }) => {
    test.setTimeout(30_000);
    await open(page);
    await next(page);
    // Typed like a person (the autosave skips the edit that first makes the form dirty; ledgered, not this plan's).
    await page.locator('#create-project-title').pressSequentially('Garden Map', { delay: 20 });
    // Drafts save 5 s after the last edit, to IndexedDB (idb-keyval), falling back to localStorage.
    await page.waitForTimeout(7000);
    const stored = await page.evaluate(() => new Promise<string>((resolve) => {
        const local = Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? '').join('\n');
        const req = indexedDB.open('keyval-store');
        req.onerror = () => resolve(local);
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('keyval')) return resolve(local);
            const all = db.transaction('keyval').objectStore('keyval').getAll();
            all.onsuccess = () => resolve(local + JSON.stringify(all.result));
            all.onerror = () => resolve(local);
        };
    }));
    expect(stored).toContain('Garden Map');
    expect(stored).not.toContain('fromReview');
});

// v6.8: the top bar's New workspace, while you're making one, stays pressed, shows the step and answers a press.
test('New workspace stays pressed and counts the steps', async ({ page }) => {
    await open(page, '/workspaces/new?topbar=1');
    const cell = page.getByRole('link', { name: /^New workspace/ });
    await expect(cell).toHaveAttribute('aria-current', 'page');
    await expect(cell).toHaveAttribute('data-pressed', 'true');
    await expect(cell).toContainText('1/5');
    await expect(cell.locator('[data-on]')).toHaveCount(1);
    await next(page);
    await expect(cell).toContainText('2/5');
    await expect(cell.locator('[data-on]')).toHaveCount(2);
});

test('pressing New workspace again goes back to the step, never starting over', async ({ page }) => {
    await open(page, '/workspaces/new?topbar=1');
    await next(page);
    await fillInfo(page);
    await page.locator('[data-wizard-scroll]').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.getByRole('link', { name: /^New workspace/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'You’re making one. Back to Info.' })).toBeVisible();
    await expect.poll(() => page.locator('[data-wizard-scroll]').evaluate((el) => el.scrollTop)).toBe(0);
    await expect(page.locator('#create-project-title')).toHaveValue('Garden Map');
    expect(await page.evaluate(() => (window as any).__pushed)).toEqual([]);
});
