import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';

// The organization row in the left navigation, against the real component and stylesheet.
const origin = 'https://org-sidebar.test';
let script: string, css: string;

test.beforeAll(async () => {
    const mocks: Record<string, string> = {
        'next/link': `import React from 'react';export default ({href,children,prefetch,...p})=>React.createElement('a',{href,...p},children);`,
        'next/navigation': `export const usePathname=()=>'/org/cse-3b';`,
    };
    const bundle = await build({ entryPoints: [path.resolve('tests/browser/org-sidebar.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'org-sidebar-boundaries', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }] });
    script = bundle.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, view: 'expanded' | 'collapsed') {
    await page.setViewportSize({ width: 1200, height: 500 });
    await page.route(origin + '/**', route => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?view=${view}`);
    await page.locator('[data-org-row]').first().waitFor();
}

test('Reads name, plus, number, drop-down, with nothing overlapping', async ({ page }) => {
    await open(page, 'expanded');
    const row = page.locator('[data-org-row]').first();
    const parts = await Promise.all([
        row.getByRole('link', { name: /need you/ }).locator('span').last(),
        row.getByRole('link', { name: /^New workspace/ }),
        row.locator('.nb-nav-count'),
        row.getByRole('button', { name: /^Collapse/ }),
    ].map(async (part) => (await part.boundingBox())!));
    for (let i = 1; i < parts.length; i++) expect(parts[i].x).toBeGreaterThanOrEqual(parts[i - 1].x + parts[i - 1].width);
    const centers = parts.slice(1).map((box) => box.y + box.height / 2);
    for (const center of centers) expect(Math.abs(center - centers[0])).toBeLessThanOrEqual(1);
    await expect(row.locator('.nb-nav-dot')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('expanded.png'), clip: { x: 0, y: 0, width: 240, height: 240 } });
});

test('The icon lines up with the workspaces below it and carries no dot', async ({ page }) => {
    await open(page, 'expanded');
    const org = await page.locator('[data-org-row]').first().getByText('CS', { exact: true }).boundingBox();
    const personal = await page.getByRole('link', { name: 'Ponytail' }).getByText('PO', { exact: true }).boundingBox();
    expect(org!.x).toBe(personal!.x);
    await expect(page.locator('[data-org-row]').first().getByText('CS', { exact: true }).locator('span')).toHaveCount(0);
});

test('The drop-down opens and closes the row; the row link is not triggered', async ({ page }) => {
    await open(page, 'expanded');
    const row = page.locator('[data-org-row]').first();
    await expect(page.getByRole('link', { name: 'Team Falcon' })).toBeVisible();
    await row.getByRole('button', { name: /^Collapse/ }).click();
    await expect(page.getByRole('link', { name: 'Team Falcon' })).toBeHidden();
    await expect(page).toHaveURL(/view=expanded/);
});

test('Clicking the name or the number opens the organization', async ({ page }) => {
    await open(page, 'expanded');
    const row = page.locator('[data-org-row]').first();
    const hit = await row.locator('.nb-nav-count').evaluate((count) => {
        const box = count.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('a')?.getAttribute('href');
    });
    expect(hit).toBe('/org/cse-3b');
    const plus = await row.getByRole('link', { name: /^New workspace/ }).evaluate((link) => {
        const box = link.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('a') === link;
    });
    expect(plus).toBe(true);
});

test('New workspace is reachable by keyboard', async ({ page }) => {
    test.skip(test.info().project.name === 'webkit', 'Safari moves focus to links only with Option-Tab');
    await open(page, 'expanded');
    await page.locator('[data-org-row]').first().getByRole('link', { name: /need you/ }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /^New workspace/ })).toBeFocused();
});

test('An announcement with no number takes the number\'s place; no plus without permission', async ({ page }) => {
    await open(page, 'expanded');
    const quiet = page.locator('[data-org-row]').nth(1);
    await expect(quiet.locator('.nb-nav-dot')).toBeVisible();
    await expect(quiet.getByRole('link', { name: /^New workspace/ })).toHaveCount(0);
});

test('Collapsed: number and announcement dot stay; plus and drop-down go', async ({ page }) => {
    await open(page, 'collapsed');
    const [busy, quiet] = [page.locator('[data-org-row]').first(), page.locator('[data-org-row]').nth(1)];
    await expect(busy.locator('.nb-nav-count')).toBeVisible();
    await expect(quiet.locator('.nb-nav-dot')).toBeVisible();
    await expect(busy.getByRole('link', { name: /^New workspace/ })).toBeHidden();
    await expect(busy.getByRole('button')).toBeHidden();
    const personal = (await page.getByRole('link', { name: 'Ponytail' }).getByText('PO', { exact: true }).boundingBox())!;
    expect((await busy.getByText('CS', { exact: true }).boundingBox())!.x).toBe(personal.x);
    const dot = (await quiet.locator('.nb-nav-dot').boundingBox())!;
    const icon = (await quiet.getByText('QU', { exact: true }).boundingBox())!;
    expect(Math.abs(dot.x + dot.width / 2 - (icon.x + icon.width))).toBeLessThanOrEqual(4);
    expect(Math.abs(dot.y + dot.height / 2 - icon.y)).toBeLessThanOrEqual(4);
    await page.screenshot({ path: test.info().outputPath('collapsed.png'), clip: { x: 0, y: 0, width: 120, height: 240 } });
});
