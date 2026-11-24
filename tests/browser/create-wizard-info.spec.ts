import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { buildApp, openApp } from './app-bundle';
import { ENTRY, heading, next } from './create-wizard-helpers';

// Create workspace v6, Task 4: Info — filled from the source with Undo, 8 categories + More, folded problem/approach,
// and the real address (plain when free, -2 when taken).
test.beforeAll(async () => { await buildApp(ENTRY); });
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page: Page, upload = false) {
    await openApp(page, ENTRY, {
        path: '/workspaces/new',
        beforeGoto: async (p) => {
            await p.addInitScript(() => {
                (window as any).__extraActions = {
                    previewWorkspaceSlugAction: async (title: string) => {
                        if ((window as any).__slowPreview) await new Promise((r) => setTimeout(r, 1500));
                        const base = title.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-');
                        return Promise.resolve(base === 'atlas-maps' ? { base, slug: `${base}-2`, taken: true } : { base, slug: base, taken: false });
                    },
                };
            });
        },
    });
    await expect(heading(page, 'What are you starting from?')).toBeVisible();
    if (upload) {
        await page.getByRole('tab', { name: /Upload files/ }).click();
        // A folder with a README and a package.json: the real analysis reads them in the browser.
        const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'nb-create-')), 'garden-map');
        await mkdir(dir);
        await writeFile(path.join(dir, 'README.md'), '# Garden Map\n\nEvery plot, crop and volunteer day in town, on one map. Gardeners mark what grows where.\n');
        await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'garden-map', description: 'Every plot, crop and volunteer day in town, on one map. Gardeners mark what grows where.', dependencies: { react: '19', typescript: '5' } }));
        await page.locator('input[type="file"][webkitdirectory]').setInputFiles(dir);
        await expect(page.locator('[data-start-status]')).toContainText('files', { timeout: 10_000 });
    }
    await next(page);
    await expect(heading(page, 'Name it, then explain it.')).toBeVisible();
}

test('a folder fills the empty fields, marks them, and Undo takes them back out', async ({ page }) => {
    await open(page, true);
    await expect(page.locator('.nb-srcnote')).toContainText('Filled from');
    await expect(page.locator('#create-project-title')).not.toHaveValue('');
    await expect(page.getByText('from folder').first()).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('#create-project-title')).toHaveValue('');
    await expect(page.locator('.nb-srcnote')).toHaveCount(0);
});

test('eight categories show first; More shows the rest', async ({ page }) => {
    await open(page);
    const cells = page.locator('#create-project-category [role="radio"]');
    await expect(cells).toHaveCount(8);
    await page.getByRole('button', { name: /More categories/ }).click();
    await expect(cells).toHaveCount(16);
    await page.getByRole('radio', { name: /Side project/ }).click();
    await expect(page.getByRole('radio', { name: /Side project/ })).toHaveAttribute('aria-checked', 'true');
});

test('problem and approach stay one line until opened', async ({ page }) => {
    await open(page);
    await expect(page.locator('#create-project-problem')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add problem and approach' }).click();
    await expect(page.locator('#create-project-problem')).toBeFocused();
    await expect(page.locator('#create-project-solution')).toBeVisible();
});

test('the address line says free, or which address a taken name gets', async ({ page }) => {
    await open(page);
    await page.locator('#create-project-title').fill('Garden Map');
    await expect(page.locator('[data-address]')).toContainText('networkbase.in/w/garden-map · free');
    await page.locator('#create-project-title').fill('Atlas Maps');
    await expect(page.locator('[data-address]')).toContainText('networkbase.in/w/atlas-maps is taken');
    await expect(page.locator('[data-address]')).toContainText('networkbase.in/w/atlas-maps-2');
});

test('a name changed right before Continue never keeps the address of an older name', async ({ page }) => {
    await open(page);
    await page.locator('#create-project-title').fill('Garden Ma');
    await expect(page.locator('[data-address]')).toContainText('networkbase.in/w/garden-ma · free');
    await page.evaluate(() => { (window as any).__slowPreview = true; });
    await page.locator('#create-project-title').fill('Garden Map');
    await page.getByRole('radio', { name: /Side project/ }).click();
    await page.locator('#create-project-description').fill('A shared map of community gardens with plots and volunteer days.');
    await next(page);
    await next(page);
    await next(page);
    await expect(heading(page, 'Ready to create.')).toBeVisible();
    await page.locator('[data-review-section="2"] [data-review-line]').click();
    await expect(page.locator('[data-review-section="2"]')).not.toContainText('networkbase.in/w/garden-ma');
});
