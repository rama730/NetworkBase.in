import { expect, test, type Page } from '@playwright/test';
import { buildApp, openApp } from './app-bundle';
import { ENTRY, fillInfo, heading, next } from './create-wizard-helpers';

// Create workspace v6, Task 7: Review — sections are one line until opened, "Show only what I changed", a sticky side
// with the check-up, the real Discover card (or the search row) and what Create will do.
test.beforeAll(async () => { await buildApp(ENTRY); });
test.use({ viewport: { width: 1440, height: 900 } });

async function openReview(page: Page) {
    await openApp(page, ENTRY, {
        path: '/workspaces/new',
        beforeGoto: async (p) => { await p.addInitScript(() => { (window as any).__extraActions = { previewWorkspaceSlugAction: () => Promise.resolve(null) }; }); },
    });
    await expect(heading(page, 'What are you starting from?')).toBeVisible();
    await next(page);
    await fillInfo(page);
    await next(page);
    await page.locator('[data-popular-roles]').getByRole('button', { name: '+ Frontend developer' }).click();
    await next(page);
    await expect(heading(page, 'How it starts.')).toBeVisible();
    await next(page);
    await expect(heading(page, 'Ready to create.')).toBeVisible();
}

const section = (page: Page, step: number) => page.locator(`[data-review-section="${step}"]`);

test('sections collapse to one line', async ({ page }) => {
    await openReview(page);
    await expect(section(page, 2).locator('[data-review-line]')).toContainText('Garden Map');
    await expect(section(page, 2).getByText('A shared map of community gardens with plots and volunteer days.')).toHaveCount(0);
    await section(page, 2).locator('[data-review-line]').click();
    await expect(section(page, 2).getByText('A shared map of community gardens with plots and volunteer days.')).toBeVisible();
    await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(section(page, 3).getByText('Frontend developer').first()).toBeVisible();
    await section(page, 3).getByRole('button', { name: 'Edit' }).click();
    await expect(heading(page, 'Who’s building it?')).toBeVisible();
    await expect(page.getByRole('button', { name: /Back to Review/ })).toBeVisible();
});

test('changed only shows Nothing changed', async ({ page }) => {
    await openReview(page);
    await expect(page.locator('[data-review-bar]')).toContainText('0 of 8 settings changed');
    await page.getByRole('switch', { name: 'Show only what I changed' }).click();
    await expect(section(page, 4)).toContainText('Nothing changed from the defaults.');
});

test('card views switch Discover/Search', async ({ page }) => {
    await openReview(page);
    const side = page.locator('[data-review-side]');
    await expect(side.getByRole('radio', { name: 'Discover' })).toHaveAttribute('aria-checked', 'true');
    await expect(side.locator('.nb-project-card')).toHaveCount(1);
    await side.getByRole('radio', { name: 'Search' }).click();
    await expect(side.locator('.nb-project-card')).toHaveCount(0);
    await expect(side.getByRole('option', { name: 'Open workspace Garden Map' })).toBeVisible();
    await expect(side).toContainText('1 open role');
});

test('card matches Discover markup', async ({ page }) => {
    await openReview(page);
    const card = page.locator('[data-review-side] .nb-project-card');
    await expect(card).toHaveAttribute('data-kind', 'project');
    await expect(card.locator('h3.nb-project-card-title')).toHaveText('Garden Map');
    await expect(page.locator('[data-review-side]')).toContainText('Exactly as it shows on Discover.');
    // The check-up and what Create does sit beside it.
    await expect(page.locator('[data-review-side]')).toContainText('5 of 5 required');
    await expect(page.locator('[data-create-steps] li').first()).toContainText('Making Garden Map');
    await expect(page.locator('[data-create-steps]')).toContainText('Posting 1 opening on Discover');
    // Sticky: the side stays in view when the sections scroll.
    const before = await page.locator('[data-review-side]').boundingBox();
    await page.locator('[data-wizard-scroll]').evaluate((el) => { el.scrollTop = 300; });
    await page.waitForTimeout(150);
    const after = await page.locator('[data-review-side]').boundingBox();
    expect(after!.y).toBeGreaterThan(before!.y - 300 + 1);
});
