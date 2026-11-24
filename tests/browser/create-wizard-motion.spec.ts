import { expect, test, type Page } from '@playwright/test';
import { buildApp, openApp } from './app-bundle';
import { ENTRY, fillInfo, heading, next } from './create-wizard-helpers';

// Create workspace v6, Task 10: the motion pass (the prototype's motiontest checks), and reduced motion runs nothing.
test.beforeAll(async () => { await buildApp(ENTRY); });
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page: Page) {
    await openApp(page, ENTRY, {
        path: '/workspaces/new',
        beforeGoto: async (p) => { await p.addInitScript(() => { (window as any).__extraActions = { previewWorkspaceSlugAction: () => Promise.resolve(null), createWorkspaceAction: () => Promise.resolve({ success: true, project: { id: '00000000-0000-4000-8000-0000000000dd', title: 'Garden Map', slug: 'garden-map' } }) }; }); },
    });
    await expect(heading(page, 'What are you starting from?')).toBeVisible();
}
const running = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length);

test('the step marker is kept and the step slides in', async ({ page }) => {
    await open(page);
    await page.locator('[data-step-marker]').evaluate((el) => { (el as any).__kept = true; });
    await next(page);
    expect(await page.locator('[data-step-marker]').evaluate((el) => Boolean((el as any).__kept))).toBe(true);
    expect(await running(page, '.nb-step-enter')).toBeGreaterThan(0);
});

test('a removed chip stays while it leaves', async ({ page }) => {
    await open(page);
    await next(page);
    await page.locator('#create-project-tag-input').fill('Maps');
    await page.locator('#create-project-tag-input').press('Enter');
    const chip = page.locator('.nb-chipbox .nb-tag', { hasText: 'Maps' });
    await expect(chip).toBeVisible();
    await page.getByRole('button', { name: 'Remove Maps' }).click();
    await expect(chip).toHaveAttribute('data-leaving', 'true');
    await expect(chip).toHaveCount(0);
});

test('the role editor reveals, rows below move with it, and openings roll', async ({ page }) => {
    await open(page);
    await next(page);
    await fillInfo(page);
    await next(page);
    await page.locator('[data-popular-roles]').getByRole('button', { name: '+ Backend developer' }).click();
    await page.locator('[data-role-editor]').getByRole('button', { name: 'Done' }).click();
    await page.locator('[data-popular-roles]').getByRole('button', { name: '+ Frontend developer' }).click();
    await page.locator('[data-role-editor]').getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Edit Backend developer' }).click();
    expect(await running(page, '[data-role-editor]')).toBeGreaterThan(0);
    // The row below slides down instead of jumping (FLIP).
    expect(await page.locator('[data-role-row]').nth(1).evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0);
    await page.locator('[data-role-editor]').getByRole('button', { name: 'More openings' }).click();
    await expect(page.locator('[data-role-editor] .nb-stepper b')).toHaveText('2');
});

test('the Settings highlight slides and Finish rows arrive one after another', async ({ page }) => {
    await open(page);
    await next(page);
    await fillInfo(page);
    await next(page);
    await next(page);
    const hl = page.locator('[data-nav-highlight]');
    expect(await hl.evaluate((el) => getComputedStyle(el).transitionDuration)).toContain('0.22s');
    await next(page);
    await page.getByRole('button', { name: /Create workspace/ }).click();
    await expect(heading(page, 'Garden Map is open.')).toBeVisible();
    const delays = await page.locator('[data-made] li').evaluateAll((els) => els.map((el) => getComputedStyle(el).animationDelay));
    expect(new Set(delays).size).toBeGreaterThan(1);
});

test('reduced motion runs nothing longer than 1 ms', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await next(page);
    await fillInfo(page);
    await next(page);
    await page.locator('[data-popular-roles]').getByRole('button', { name: '+ Frontend developer' }).click();
    const long = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && Number(a.effect?.getComputedTiming().duration ?? 0) > 1).map((a) => (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? 'waapi'));
    expect(long).toEqual([]);
});
