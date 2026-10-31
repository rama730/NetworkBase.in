import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test } from '@playwright/test';

// The Updated by line against the real component and stylesheet; only the server action is replaced.
const origin = 'https://last-update.test';
let script: string, css: string;

test.beforeAll(async () => {
    const mocks: Record<string, string> = {
        '@/app/actions/workspace/last-update': `export const getWorkspaceLastUpdates=async({projectIds})=>{window.lastUpdateCalls=(window.lastUpdateCalls||0)+1;return projectIds.map((projectId,i)=>i===2?null:{projectId,at:new Date(Date.now()-(i===0?2*36e5:3*864e5)).toISOString(),byName:i===0?'Rama':null}).filter(Boolean);};`,
        '@/app/actions/presence': `export const getPresence=async()=>({success:true,presence:[]});`,
        '@/components/presence/live-online': `export const useLiveOnline=()=>undefined;`,
    };
    const bundle = await build({ entryPoints: [path.resolve('tests/browser/workspace-last-update.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'last-update-boundaries', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }] });
    script = bundle.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

test('Shows who and when, batches into one request, and stays out of the way when there is nothing', async ({ page }) => {
    await page.route(origin + '/**', route => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(origin);
    const lines = page.getByTestId('workspace-last-update');
    await expect(lines).toHaveText(['Updated by Rama · 2h ago', 'Updated 3d ago', '2h ago']);
    await expect(lines.first()).toHaveAttribute('title', /\d{4}/);
    await expect(page.locator('[data-row="slug"]')).toBeEmpty();
    expect(await page.evaluate(() => (window as unknown as { lastUpdateCalls: number }).lastUpdateCalls)).toBe(1);
    await page.screenshot({ path: test.info().outputPath('last-update.png'), clip: { x: 0, y: 0, width: 360, height: 160 } });
});
