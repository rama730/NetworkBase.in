import { exportedNames, serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from './axe';

// Report Part B: "Ram · with Claude Code" and workspace settings → Agents → "Show when agents helped".
const origin = 'https://agent-labels.test';
let script: string, css: string;

test.beforeAll(async () => {
    const mocks: Record<string, string> = {
        '@/app/actions/workspace/agents': `const kase=new URLSearchParams(location.search).get('case')||'owner';let labels='everyone';
            const log=(x)=>{const o=document.getElementById('calls')||document.body.appendChild(Object.assign(document.createElement('output'),{id:'calls'}));o.textContent+=JSON.stringify(x)+';'};
            export const getWorkspaceAgentSettingsAction=async()=>({success:true,policy:'ask_important',paused:false,labels,canChangeLabels:kase!=='admin',inOrganization:kase==='org'});
            export const updateWorkspaceAgentSettingsAction=async(i)=>{log(i);if(i.labels)labels=i.labels;return{success:true,policy:'ask_important',paused:false,labels};};`,
    };
    for (const [spec, source] of [['@/app/actions/workspace/agents', 'src/app/actions/workspace/agents.ts']] as const) {
        const own = new Set(exportedNames(mocks[spec]!));
        mocks[spec] += exportedNames(await readFile(source, 'utf8')).filter((n) => !own.has(n)).map((n) => `export const ${n}=async()=>({success:false,error:'Not in this fixture'});`).join('');
    }
    const out = await build({ entryPoints: [path.resolve('tests/browser/agent-labels.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'labels', setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }, serverActionsPlugin] });
    script = out.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, kase = 'owner', width = 1440, theme: 'light' | 'dark' = 'light') {
    await page.setViewportSize({ width, height: 1000 });
    await page.route(origin + '/**', (route) => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : `<html lang="en" class="${theme}"><head><title>Labels</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?case=${kase}`);
    await expect(page.getByRole('group', { name: 'Show when agents helped' })).toBeVisible();
}

test('the person is the author: muted "with Claude Code" or "with the CLI", no icon, nothing for app work', async ({ page }) => {
    await open(page);
    const items = page.getByRole('list', { name: 'Labels' }).getByRole('listitem');
    await expect(items.nth(0)).toHaveText('Ram · with Claude Code');
    await expect(items.nth(1)).toHaveText('Ram · with the CLI');
    await expect(items.nth(2)).toHaveText('Ram');
    await expect(page.getByRole('list', { name: 'Labels' }).locator('svg')).toHaveCount(0);
});

test('the owner picks who sees it, one click, with a line explaining each choice', async ({ page }) => {
    await open(page);
    const group = page.getByRole('group', { name: 'Show when agents helped' });
    await expect(group.getByRole('radio', { name: /Everyone/ })).toBeChecked();
    await expect(group).toContainText('Hidden for everyone. Agent activity, Undo and Pause agents still work.');
    await group.getByRole('radio', { name: /Only the person/ }).check();
    await expect(page.locator('#calls')).toHaveText('{"projectId":"11111111-1111-4111-8111-111111111111","labels":"person"};');
    await expect(group.getByRole('radio', { name: /Only the person/ })).toBeChecked();
});

test('admins see the choice but only the owner can change it; in an organization the class rule is explained', async ({ page }) => {
    await open(page, 'admin');
    const group = page.getByRole('group', { name: 'Show when agents helped' });
    await expect(group).toContainText('Only the workspace owner can change this.');
    await expect(group.getByRole('radio', { name: /No one/ })).toBeDisabled();
    await open(page, 'org');
    await expect(page.getByRole('group', { name: 'Show when agents helped' })).toContainText('its teachers and reviewers still see it');
});

for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark'] as const) {
        test(`fits ${width} px in ${theme} and passes axe`, async ({ page }) => {
            await open(page, 'org', width, theme);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            expect(await axeViolations(page)).toEqual([]);
            if (width === 390) await page.screenshot({ path: `test-results/agent-labels/settings-${width}-${theme}.png`, fullPage: true });
        });
    }
}
