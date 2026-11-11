import { exportedNames, serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from './axe';

// Report A4 "Afterwards", A5 (asking for more, change access, renewal), A8: the agent's Settings page.
const origin = 'https://agent-access.test';
let script: string, css: string;

test.beforeAll(async () => {
    const mocks: Record<string, string> = {
        '@/app/actions/agent-access': `let verified=false;const log=(x)=>{const o=document.getElementById('calls')||document.body.appendChild(Object.assign(document.createElement('output'),{id:'calls'}));o.textContent+=x+';'};
            const fresh=()=>verified?null:{success:false,error:"Verify it's you first",stepUpRequired:true,stepUp:{methods:['password']}};
            export const changeAgentAccessAction=async(id,c)=>fresh()??(log('change:'+c.access+':'+c.workspace+':'+c.expiryDays),{success:true,sentence:'changed'});
            export const renewAgentAccessAction=async(id,d)=>fresh()??(log('renew:'+d),{success:true,sentence:'renewed'});
            export const decideAgentAccessRequestAction=async(id,a)=>a==='always'&&fresh()||(log('answer:'+a),{success:true,scope:'task:complete',answer:a});
            export const __verify=()=>{verified=true};`,
        '@/components/settings/SecurityStepUpDialog': `import React from 'react';import {__verify} from '@/app/actions/agent-access';
            export default ({open,onVerified,title})=>open?React.createElement('div',{role:'dialog','aria-label':title},React.createElement('button',{onClick:()=>{__verify();onVerified()}},'Verify')):null;`,
    };
    for (const [spec, source] of [['@/app/actions/agent-access', 'src/app/actions/agent-access.ts']] as const) {
        const own = new Set(exportedNames(mocks[spec]!));
        mocks[spec] += exportedNames(await readFile(source, 'utf8')).filter((n) => !own.has(n)).map((n) => `export const ${n}=async()=>({success:false,error:'Not in this fixture'});`).join('');
    }
    const out = await build({ entryPoints: [path.resolve('tests/browser/agent-access.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'agent-access', setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }, serverActionsPlugin] });
    script = out.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, kase = 'requests', width = 1440) {
    await page.setViewportSize({ width, height: 900 });
    await page.route(origin + '/**', (route) => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html lang="en"><head><title>Agent access</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?case=${kase}`);
    await expect(page.getByRole('heading', { name: 'Claude Code on Chs-MacBook' })).toBeVisible();
}
const calls = (page: Page) => page.locator('#calls');

test('the sentence, a waiting request, and Always asks to verify first', async ({ page }) => {
    await open(page);
    await expect(page.getByText(/^Claude Code can work in all your workspaces for 30 days/)).toBeVisible();
    const waiting = page.getByRole('region', { name: 'Waiting for your answer' });
    await expect(waiting).toContainText('Claude Code asks to also finish tasks.');
    await waiting.getByRole('button', { name: 'Always' }).click();
    await expect(page.getByRole('dialog', { name: 'Verify it’s you' })).toBeVisible();
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(calls(page)).toHaveText('answer:always;');
    await expect(page.getByRole('region', { name: 'Waiting for your answer' })).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
});

test('Change access: the sentence follows the choice; read-only and agents-off workspaces say why', async ({ page }) => {
    await open(page, 'none');
    await page.getByRole('button', { name: 'Change access' }).click();
    await page.getByRole('radio', { name: 'Read only' }).check();
    await expect(page.getByText(/^Claude Code can read all your workspaces for 30 days\. It can't change anything\./)).toBeVisible();
    await page.getByRole('radio', { name: 'One workspace' }).check();
    const list = page.getByRole('radiogroup', { name: 'Workspace' });
    await expect(list).toContainText('Your workspaces');
    await expect(list).toContainText('Riverside College');
    await expect(list.getByRole('radio', { name: /CSE 3B labs/ })).toBeDisabled();
    await expect(list.getByText('Agents off')).toBeVisible();
    await list.getByRole('radio', { name: /Shared notes/ }).check();
    await expect(page.getByRole('radio', { name: 'Full help' })).toBeDisabled();
    await page.getByRole('radio', { name: '7 days' }).check();
    await expect(page.getByText(/^Claude Code can read Shared notes for 7 days/)).toBeVisible();
    await page.getByRole('button', { name: 'Save access' }).click();
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(calls(page)).toHaveText('change:read:22222222-2222-4222-8222-222222222222:7;');
    expect(await axeViolations(page)).toEqual([]);
});

test('Renew, by keyboard only', async ({ page, browserName }) => {
    await open(page, 'none');
    await page.getByRole('combobox').focus();
    // Safari's Tab skips buttons unless the person turns on "Press Tab to highlight each item".
    if (browserName === 'webkit') await page.getByRole('button', { name: 'Renew' }).focus();
    else await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Renew' })).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Verify' }).press('Enter');
    await expect(calls(page)).toHaveText('renew:30;');
});

for (const theme of ['light', 'dark'] as const) {
    test(`fits a 390 px phone and passes axe in ${theme}`, async ({ page }) => {
        await open(page, 'requests', 390);
        await page.evaluate((t) => document.documentElement.classList.toggle('dark', t === 'dark'), theme);
        await page.getByRole('button', { name: 'Change access' }).click();
        await page.getByRole('radio', { name: 'One workspace' }).check();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(await axeViolations(page)).toEqual([]);
        await page.screenshot({ path: `test-results/agent-access/settings-390-${theme}.png`, fullPage: true });
    });
}
