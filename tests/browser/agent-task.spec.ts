import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from './axe';
import { serverActionsPlugin } from './server-actions-plugin';

// Report D5, D16 (M4c): the task shows which agents are working on it, and the notes where an agent stopped.
const origin = 'https://agent-task.test';
const TASK = '22222222-2222-4222-8222-222222222222';
let script: string, css: string;

test.beforeAll(async () => {
    const out = await build({ entryPoints: [path.resolve('tests/browser/agent-task.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [serverActionsPlugin] });
    script = out.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, width = 1440, theme: 'light' | 'dark' = 'light') {
    await page.setViewportSize({ width, height: 900 });
    const deleted: string[] = [];
    const now = Date.now();
    let notes = [
        { id: 'aaaaaaaa-0000-4000-8000-000000000001', note: 'parsed 3 of 5 files; next: tests', agentName: 'Claude Code', createdAt: new Date(now - 5 * 60_000).toISOString() },
        { id: 'aaaaaaaa-0000-4000-8000-000000000002', note: 'set up the parser', agentName: 'Codex', createdAt: new Date(now - 3 * 3_600_000).toISOString() },
    ];
    await page.route(origin + '/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === `/api/v1/tasks/${TASK}/presence`) return route.fulfill({ json: { success: true, data: { agents: [{ agentName: 'Claude Code', at: new Date(now - 10_000).toISOString() }, { agentName: 'Codex', at: new Date(now - 20_000).toISOString() }, { agentName: 'Cursor', at: new Date(now - 200_000).toISOString() }] } } });
        if (url.pathname === `/api/v1/tasks/${TASK}/agent-notes`) {
            if (route.request().method() === 'DELETE') {
                const { id } = route.request().postDataJSON() as { id: string };
                deleted.push(id);
                notes = notes.filter((n) => n.id !== id);
                return route.fulfill({ json: { success: true, data: { deleted: id } } });
            }
            return route.fulfill({ json: { success: true, data: { notes } } });
        }
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : `<html lang="en" class="${theme}"><head><title>Agent task</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body class="bg-background"><div id="root"></div><script src="/app.js"></script></body></html>`;
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/`);
    await expect(page.getByRole('heading', { name: 'Agent notes' })).toBeVisible();
    return { deleted };
}

test('who is working on the task now: an agent quiet for over 90 seconds is gone', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('status')).toHaveText('Claude Code and Codex are working on this');
});

test('agent notes, newest first, each with who and when; the person deletes one', async ({ page }) => {
    const { deleted } = await open(page);
    const items = page.getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('parsed 3 of 5 files; next: tests');
    await expect(items.nth(0)).toContainText('Claude Code · 5 minutes ago');
    await page.getByRole('button', { name: 'Delete the note from Codex' }).click();
    await expect(items).toHaveCount(1);
    expect(deleted).toEqual(['aaaaaaaa-0000-4000-8000-000000000002']);
});

for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark'] as const) {
        test(`fits ${width} px in ${theme} and passes axe`, async ({ page }) => {
            await open(page, width, theme);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            expect(await axeViolations(page)).toEqual([]);
            await page.screenshot({ path: `test-results/agent-task/${width}-${theme}.png`, fullPage: true });
        });
    }
}
