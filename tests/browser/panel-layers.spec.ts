import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Locator, type Page } from '@playwright/test';

// Student check 2 (live, 4 Nov): Status, Edit for everyone and the delete confirmation opened behind the task panel.
const origin = 'https://panel-layers.test';
let script: string, css: string;

test.beforeAll(async () => {
    const bundle = await build({ entryPoints: [path.resolve('tests/browser/panel-layers.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' }, alias: { '@': path.resolve('src') }, jsx: 'automatic' });
    script = bundle.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page) {
    await page.route(origin + '/**', route => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(origin + '/');
}

/** True when the element's own centre is the topmost thing there, not the panel above it. */
async function onTop(target: Locator) {
    return target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!hit && (el === hit || el.contains(hit));
    });
}

test('menus, selects and dialogs opened from the task panel show above it', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Select status' }).click();
    const item = page.getByRole('menuitem', { name: 'In progress' });
    await expect(item).toBeVisible();
    expect(await onTop(item)).toBe(true);
    await page.keyboard.press('Escape');

    await page.getByRole('combobox', { name: 'Priority' }).click();
    const option = page.getByRole('option', { name: 'High' });
    await expect(option).toBeVisible();
    expect(await onTop(option)).toBe(true);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('button', { name: 'Confirm delete' });
    await expect(confirm).toBeVisible();
    expect(await onTop(confirm)).toBe(true);
});
