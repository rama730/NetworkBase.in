import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';

import { serverActionsPlugin } from './server-actions-plugin';

// Report §32.3, decision 75: no browser pop-ups; the shared dialog asks, and nothing is lost on Keep editing.
const origin = 'https://shared-confirm.test';
let script: string, css: string;

test.beforeAll(async () => {
    const mocks: Record<string, string> = {
        'next/navigation': `export const useRouter=()=>({refresh(){},push(){},replace(){}}),usePathname=()=>'/',useSearchParams=()=>new URLSearchParams();`,
        '@/hooks/useLinkPreview': `export const fetchLinkPreview=async()=>null,useLinkPreview=()=>({data:null,loading:false}),extractFirstUrl=()=>null;`,
    };
    const bundle = await build({ entryPoints: [path.resolve('tests/browser/shared-confirm.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' }, alias: { '@': path.resolve('src') }, jsx: 'automatic', plugins: [{ name: 'mocks', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }, serverActionsPlugin] });
    script = bundle.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, view: string) {
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.type()); void d.dismiss(); });
    await page.route(origin + '/**', route => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?view=${view}`);
    return dialogs;
}

test('Closing the links editor with unsaved links asks in the shared dialog; Keep editing keeps them', async ({ page }) => {
    const dialogs = await open(page, 'links');
    await page.getByRole('button', { name: /^Remove/ }).first().click();
    await page.keyboard.press('Escape');
    const ask = page.getByRole('alertdialog', { name: 'Discard your unsaved workspace link changes?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Keep editing' }).click();
    await expect(ask).toHaveCount(0);
    await expect(page.getByTestId('links-state')).toHaveText('open');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Discard your unsaved workspace link changes?' }).getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByTestId('links-state')).toHaveText('closed');
    expect(dialogs).toEqual([]);
});

test('Leaving a file with unsaved changes asks in the shared dialog; Discard and leave goes on', async ({ page }) => {
    const dialogs = await open(page, 'files');
    await page.getByRole('button', { name: 'Go to another tab' }).click();
    await expect(page.getByTestId('went')).toHaveText('1', { timeout: 2000 });
    await page.getByRole('button', { name: 'Make unsaved' }).click();
    await page.getByRole('button', { name: 'Go to another tab' }).click();
    const ask = page.getByRole('alertdialog', { name: 'Discard unsaved file changes and leave this file?' });
    await ask.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByTestId('went')).toHaveText('1');
    await page.getByRole('button', { name: 'Go to another tab' }).click();
    await ask.getByRole('button', { name: 'Discard and leave' }).click();
    await expect(page.getByTestId('went')).toHaveText('2');
    expect(dialogs).toEqual([]);
});
