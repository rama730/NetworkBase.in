import { exportedNames, serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from './axe';

// Report A2 (summary first, one click), A3 (every situation), A8 (side panel, signed-out chip), 0.8 #2, #3.
const origin = 'https://device.test';
let script: string, css: string;

test.beforeAll(async () => {
    const mocks: Record<string, string> = {
        '@/app/actions/device-codes': `const kase=new URLSearchParams(location.search).get('case');let tries=0;
            const log=(x)=>{const o=document.getElementById('calls')||document.body.appendChild(Object.assign(document.createElement('output'),{id:'calls'}));o.textContent+=JSON.stringify(x)+';'};
            export const decideDeviceCodeAction=async(code,input)=>{tries++;
              if(kase==='expiring')return{success:false,error:'expired',expired:true};
              if(kase==='stepup'&&tries===1)return{success:false,error:"Verify it's you before approving",stepUpRequired:true};
              log(input);if(kase==='oauth'&&input.decision==='approve')return{success:true,decision:'approve',redirectTo:'#back-to-editor'};
              return{success:true,decision:input.decision};};`,
        '@/components/settings/SecurityStepUpDialog': `import React from 'react';export default ({open,onVerified,title})=>open?React.createElement('div',{role:'dialog','aria-label':title},React.createElement('button',{onClick:onVerified},'Verify')):null;`,
    };
    for (const [spec, source] of [['@/app/actions/device-codes', 'src/app/actions/device-codes.ts']] as const) {
        const own = new Set(exportedNames(mocks[spec]!));
        mocks[spec] += exportedNames(await readFile(source, 'utf8')).filter((n) => !own.has(n)).map((n) => `export const ${n}=async()=>({success:false,error:'Not in this fixture'});`).join('');
    }
    const out = await build({ entryPoints: [path.resolve('tests/browser/device-approval.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'device', setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }, serverActionsPlugin] });
    script = out.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, kase: string, width = 1440, theme: 'light' | 'dark' = 'light') {
    await page.setViewportSize({ width, height: 1000 });
    await page.route(origin + '/**', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/v1/auth/security-step-up') return route.fulfill({ json: { success: true, data: { availableMethods: ['password'] } } });
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : `<html lang="en" class="${theme}"><head><title>Device</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?case=${kase}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const calls = (page: Page) => page.locator('#calls');

test('the normal case: the summary, the code once, From India, and one click by keyboard', async ({ page, browserName }) => {
    await open(page, 'agent');
    await expect(h1(page)).toHaveText('Claude Code wants to work with you on NetworkBase');
    await expect(page.getByText('Approve only if your terminal shows the same code.')).toBeVisible();
    await expect(page.getByLabel('Code D 9 G M - 9 N 7 Z')).toBeVisible();
    await expect(page.getByText('D9GM-9N7Z')).toHaveCount(1);
    await expect(page.getByText('From India')).toBeVisible();
    await expect(page.getByText(/^Claude Code can work in all your workspaces for 30 days\. It does small things itself/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'What’s this?' })).toHaveAttribute('href', '/docs/agents#presets');
    await expect(page.getByText('Agents reach only the workspaces you allow')).toBeVisible();
    const approve = page.getByRole('button', { name: 'Approve' });
    if (browserName === 'webkit') await approve.focus();
    else { await page.getByRole('button', { name: 'Not me' }).focus(); await page.keyboard.press('Shift+Tab'); }
    await expect(approve).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(calls(page)).toHaveText('{"decision":"approve","type":"agent","access":"full","workspace":"all","expiryDays":30};');
    await expect(h1(page)).toHaveText('Claude Code is connected');
    await expect(page.getByText('“What should I do today?”')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings → Integrations' })).toBeVisible();
});

test('Change: the sentence follows each choice, and the approval sends it', async ({ page }) => {
    await open(page, 'agent');
    await page.getByRole('button', { name: 'Change' }).click();
    await page.getByRole('radio', { name: 'Small changes only' }).check();
    await page.getByRole('radio', { name: 'One workspace' }).check();
    await page.getByRole('radio', { name: '7 days' }).check();
    await expect(page.getByText(/^Claude Code can work in Thesis for 7 days\. It does small things itself and can't finish tasks/)).toBeVisible();
    await expect(page.getByRole('radio', { name: /CSE 3B labs/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(calls(page)).toContainText('"access":"small","workspace":"10000000-0000-4000-8000-000000000000","expiryDays":7');
});

test('the "New" banner can be dismissed and stays dismissed', async ({ page }) => {
    await open(page, 'agent');
    await expect(page.getByRole('note')).toContainText('New: approve agents in one click.');
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await page.reload();
    await expect(h1(page)).toBeVisible();
    await expect(page.getByRole('note')).toHaveCount(0);
});

test('signed out: sign in first; the hint keeps nb login --device in one piece', async ({ page }) => {
    await open(page, 'signedout');
    await expect(h1(page)).toHaveText('Sign in to approve a terminal');
    await expect(page.getByRole('button', { name: 'Sign in to continue' })).toBeVisible();
    expect(await page.locator('code', { hasText: 'nb login --device' }).evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('nowrap');
});

test('no code, and a mistyped code', async ({ page }) => {
    await open(page, 'nocode');
    await expect(h1(page)).toHaveText('Enter the code from your terminal');
    await expect(page.getByText('capitals and the dash don’t matter')).toBeVisible();
    await open(page, 'mistyped');
    await expect(h1(page)).toHaveText('This code has run out');
    await expect(page.locator('main')).toContainText('nb login --device');
    await expect(page.getByRole('button', { name: /Copy/ }).first()).toBeVisible();
});

test('a code that runs out between loading and Approve says so', async ({ page }) => {
    await open(page, 'expiring');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(h1(page)).toHaveText('This code has run out');
});

test('my own terminal: its own summary, and a switch to agent', async ({ page }) => {
    await open(page, 'terminal');
    await expect(h1(page)).toHaveText('Sign in your terminal');
    await expect(page.getByText('Your terminal can do what you can, in all your workspaces, for 90 days.')).toBeVisible();
    await page.getByRole('button', { name: 'This is actually an AI agent' }).click();
    await expect(h1(page)).toHaveText('Claude Code wants to work with you on NetworkBase');
});

test('an editor through the browser: no code box, says where it goes back to', async ({ page }) => {
    await open(page, 'oauth');
    await expect(page.getByLabel(/^Code /)).toHaveCount(0);
    await expect(page.getByText('Approving sends you back to cursor://.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'This is actually an AI agent' })).toHaveCount(0);
});

test('Verify it’s you is asked, then the approval goes through', async ({ page }) => {
    await open(page, 'stepup');
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog', { name: 'Verify before approving' }).getByRole('button', { name: 'Verify' }).click();
    await expect(h1(page)).toHaveText('Claude Code is connected');
});

test('organization turned agents off everywhere: says why and who can change it', async ({ page }) => {
    await open(page, 'orgoff');
    await expect(page.getByText(/turned AI agents off\. Its admins can turn them back on/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
});

test('only viewer access: Read only, and the summary says why', async ({ page }) => {
    await open(page, 'viewer');
    await expect(page.getByText(/^Claude Code can read all your workspaces for 30 days\. It can't change anything\./)).toBeVisible();
    await expect(page.getByText('You can only read your workspaces, so this agent can only read too.')).toBeVisible();
});

test('many workspaces: search and organization groups', async ({ page }) => {
    await open(page, 'many');
    await page.getByRole('button', { name: 'Change' }).click();
    await page.getByRole('radio', { name: 'One workspace' }).check();
    const list = page.getByRole('radiogroup', { name: 'Workspace' });
    await expect(list).toContainText('Riverside College');
    await page.getByRole('searchbox', { name: 'Search workspaces' }).fill('12');
    await expect(list.getByRole('radio')).toHaveCount(1);
});

test('no workspace yet: Create a workspace, and the sign-in keeps waiting', async ({ page }) => {
    await open(page, 'noworkspace');
    await expect(page.getByText(/You don’t have a workspace yet/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create a workspace' })).toHaveAttribute('href', '/workspaces/new');
});

test('the same agent again: Renew with its current settings, one click', async ({ page }) => {
    await open(page, 'renewal');
    await expect(h1(page)).toHaveText('Renew Claude Code’s access');
    await expect(page.getByText(/^Claude Code can work in Thesis for 7 days/)).toBeVisible();
    await page.getByRole('button', { name: 'Renew' }).click();
    await expect(calls(page)).toContainText('"access":"small"');
});

test('Not me: denies, and offers Sign out everywhere and Change password', async ({ page }) => {
    await open(page, 'agent');
    await page.getByRole('button', { name: 'Not me' }).click();
    await expect(calls(page)).toHaveText('{"decision":"deny"};');
    await expect(page.getByText(/someone tried to sign in as you from India/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign out everywhere' })).toHaveAttribute('href', '/settings#settings-security-sessions');
    await expect(page.getByRole('link', { name: 'Change password' })).toHaveAttribute('href', '/settings#settings-security-password');
});

const CASES = ['agent', 'signedout', 'nocode', 'mistyped', 'terminal', 'oauth', 'orgoff', 'viewer', 'many', 'noworkspace', 'renewal'];
for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark'] as const) {
        test(`every situation at ${width} px in ${theme}: no sideways scroll, axe clean`, async ({ page }) => {
            for (const kase of CASES) {
                await open(page, kase, width, theme);
                if (kase === 'many' || kase === 'agent') { await page.getByRole('button', { name: 'Change' }).click(); await page.getByRole('radio', { name: 'One workspace' }).check(); }
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${kase} fits`).toBe(true);
                expect(await axeViolations(page), kase).toEqual([]);
                if (kase === 'agent') await page.screenshot({ path: `test-results/device-approval/${kase}-${width}-${theme}.png`, fullPage: true });
            }
        });
    }
}
