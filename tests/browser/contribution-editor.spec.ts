import { serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';

// Live-fix phase 7 (problems 57–66): the contribution editor's list and an organization entry, against the real component.
const origin = 'https://contribution-editor.test';
let script: string, css: string;

test.beforeAll(async () => {
    const mocks: Record<string, string> = {
        '@/app/actions/contribution-stories': `export const createContributionStoryAction=async()=>({success:false,error:'x'}),saveContributionStoryAction=async(c)=>{(window.__saves||(window.__saves=[])).push(c.operation);return {success:false,error:'Saving is off in this check.'}},
            searchContributionReferencesAction=async()=>({success:true,results:[]}),createContributionImageUploadAction=async()=>({success:false,error:'x'}),finalizeContributionImageAction=async()=>({success:false,error:'x'}),
            importContributionWorkspaceImageAction=async()=>({success:false,error:'x'}),listContributionLinkWorkspacesAction=async()=>({success:true,workspaces:[]});`,
    };
    const bundle = await build({ entryPoints: [path.resolve('tests/browser/contribution-editor.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser',
        define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
        plugins: [{ name: 'mocks', setup(builder) {
            builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
        } }, serverActionsPlugin] });
    script = bundle.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, query = '') {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.route(origin + '/**', route => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html lang="en"><head><title>Contribution editor</title><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/${query}`);
}

test('Live-fix 57, 60: the list is grouped, the team workspace nests under its organization, and previews keep mentioned names', async ({ page }) => {
    await open(page);
    const drafts = page.getByRole('region', { name: 'Not on your profile yet' });
    await expect(drafts).toBeVisible();
    await expect(drafts.getByText('CSE 3B · Data Structures 2026').first()).toBeVisible();
    await expect(drafts.getByText('Team Falcon').first()).toBeVisible();
    await expect(drafts.getByText('Ran the labs with Lakshmi CH and reviews.')).toBeVisible();
});

test('Live-fix 61–66: the organization entry says who set and verified it, lists its workspace, and Publish checks what is missing', async ({ page }) => {
    await open(page, '?contribution=e1');
    await expect(page.getByText(/Set by CSE 3B · Data Structures 2026 · ✓ Verified by Ms\. Rao, Nov 2, 2026/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Workspaces in this organization' })).toContainText('Team Falcon');
    await expect(page.getByText('Back to contributions')).toBeVisible();
    await expect(page.getByText('0 positions')).toBeVisible();
    await expect(page.getByText('Clearing this also marks your positions')).toHaveCount(0);
    // Publish is there for an entry that isn't on the profile yet, with nothing edited, and it sends a publish.
    const publish = page.getByRole('button', { name: /^Publish/ });
    await expect(publish).toBeVisible();
    await publish.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __saves?: string[] }).__saves ?? [])).toContain('publish');
});
