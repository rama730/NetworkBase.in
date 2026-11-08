import { serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from './axe';

// Settings → Visibility and discovery (docs/superpowers/plans/2026-11-05-org-address-discovery-verification-findings.md
// §4, §5, §10): On Discover's states and parts, the Web address, and the Verified badge's states and four ways.
const origin = 'https://org-discovery.test';
let script: string, css: string;

test.beforeAll(async () => {
    const W = 'window.calls';
    const record = (name: string, result: string) => `async(...a)=>{(${W}=${W}||[]).push(['${name}',...a.map((x)=>x instanceof FormData?Object.fromEntries([...x.entries()].map(([k,v])=>[k,typeof v==='string'?v:v.name])):x)]);return ${result};}`;
    const mocks: Record<string, string> = {
        'next/link': `import React from 'react';export default ({href,children,prefetch,...p})=>React.createElement('a',{href,...p},children);`,
        'next/navigation': `export const useRouter=()=>({refresh(){},replace(u){(window.calls=window.calls||[]).push(['replace',u])},push(){}});export const usePathname=()=>'/org/x';export const useSearchParams=()=>new URLSearchParams();`,
        '@/app/actions/organizations': `export const renameOrgHandleAction=${record('rename', "a[1]==='taken'?{success:false,error:'networkbase.in/org/taken is taken.'}:{success:true}")};`,
        '@/app/actions/trust': [
            `export const requestOrgEmailCodeAction=${record('emailCode', "a[1].endsWith('@gmail.com')?{success:false,error:'Use an address on your organization’s own domain, not Gmail, Outlook or the like.'}:{success:true,masked:'h…@rvce.edu.in',waitSeconds:45}")};`,
            `export const confirmOrgEmailCodeAction=${record('confirm', "a[1]==='424242'?{success:true}:{success:false,error:'That code isn’t right. 4 tries left.'}")};`,
            `export const askParentOrgAction=${record('askParent', '{success:true}')};`,
            `export const checkOrgProofAction=${record('check', "{success:false,error:'We didn’t find a TXT record with the code yet. DNS changes can take up to an hour.'}")};`,
            `export const requestOrgVerificationAction=${record('team', '{success:true,verified:false}')};`,
            `export const cancelOrgVerificationAction=${record('cancel', '{success:true}')};`,
            `export const searchParentOrgsAction=async()=>[];export const decideParentVerificationAction=async()=>({success:true});`,
        ].join(''),
    };
    const bundle = await build({ entryPoints: [path.resolve('tests/browser/org-discovery.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'org-discovery-boundaries', setup(b) {
        b.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }, serverActionsPlugin] });
    script = bundle.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, query: string, width = 1100) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route(origin + '/**', route => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html lang="en"><head><title>Discovery</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?${query}`);
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as { calls?: unknown[] }).calls ?? []);
const opened = (page: Page) => page.evaluate(() => (window as unknown as { opened: string[] }).opened);

test('On Discover, waiting: the rule line, the missing parts with their actions, and the Verified badge link', async ({ page }) => {
    await open(page, 'case=waiting');
    const row = page.getByTestId('org-on-discover');
    await expect(row).toContainText('Not on Discover yet');
    await expect(row).toContainText('Organizations show once they have a tagline or description, and a workspace or a second member, or once they’re verified.');
    const needed = row.getByRole('list', { name: 'What’s needed' });
    await expect(needed).toContainText('Add a tagline or description');
    await expect(needed).toContainText('Add a workspace or invite someone');
    await expect(needed.getByRole('link', { name: 'New workspace' })).toHaveAttribute('href', '/workspaces/new?org=cse-3b-data-structures-2026');
    await expect(needed.getByRole('link', { name: 'Invite people' })).toHaveAttribute('href', '/org/cse-3b-data-structures-2026?tab=members');
    await needed.getByRole('button', { name: 'Go to Details' }).click();
    expect(await opened(page)).toEqual(['general']);
    await expect(needed.getByRole('link', { name: 'Verified badge' })).toHaveAttribute('href', '#org-verified-badge');
});

test('On Discover: listed, private, suspended, hidden and archived each say so', async ({ page }) => {
    await open(page, 'case=listed');
    const row = page.getByTestId('org-on-discover');
    await expect(row).toContainText('On Discover. People find it under Organizations, and search engines can list it.');
    await expect(row.getByRole('link', { name: 'View on Discover' })).toHaveAttribute('href', '/discover?org=cse-3b-data-structures-2026');
    await expect(row).toContainText('It can take a few minutes to appear.');
    for (const [state, text] of [['private', 'Private organizations never show there or in search engines.'], ['suspended', 'Not on Discover while it’s suspended.'], ['hidden', 'NetworkBase hid it from Discover.'], ['archived', 'Not on Discover while it’s archived.']] as const) {
        await open(page, `case=${state}`);
        await expect(page.getByTestId('org-on-discover')).toContainText(text);
    }
    await page.getByTestId('org-on-discover').getByRole('button', { name: 'Go to Moderation' }).count().then((n) => expect(n).toBe(0));
    await open(page, 'case=hidden');
    await page.getByTestId('org-on-discover').getByRole('button', { name: 'Go to Moderation' }).click();
    expect(await opened(page)).toEqual(['org-moderation']);
});

test('Web address: the full link with Copy; the owner changes it, admins read who can', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await open(page, 'case=waiting');
    const block = page.getByTestId('org-web-address');
    await expect(block).toContainText('networkbase.in/org/cse-3b-data-structures-2026');
    await expect(block).not.toContainText('@');
    await block.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByText('Link copied').first()).toBeVisible();
    await block.getByLabel('Change the address').fill('taken');
    await block.getByRole('button', { name: 'Change' }).click();
    await expect(block.getByRole('alert')).toHaveText('networkbase.in/org/taken is taken.');
    await expect(block).toContainText('Change it once every 7 days. The old link keeps working for 90 days.');
    await open(page, 'case=waiting&role=admin');
    await expect(page.getByTestId('org-web-address')).toContainText('Only the owner can change it.');
    await expect(page.getByTestId('org-web-address').getByLabel('Change the address')).toHaveCount(0);
});

test('Verified badge: what it is, who needs it, and four ways in that order for a class', async ({ page }) => {
    await open(page, 'case=waiting');
    const card = page.getByTestId('org-verified-badge');
    await expect(card).toContainText('A badge beside the name that tells visitors NetworkBase checked you’re real.');
    await expect(card).toContainText('Do you need it? Useful for colleges, companies and public communities. A class usually doesn’t need it');
    await expect(card).not.toContainText('Add your website in Links first');
    const ways = card.getByRole('listitem');
    await expect(ways).toHaveCount(4);
    await expect(ways.nth(0)).toContainText('School or work email');
    await expect(ways.nth(1)).toContainText('Confirmed by your parent organization');
    await expect(ways.nth(2)).toContainText('A code on your website, GitHub or domain');
    await expect(ways.nth(3)).toContainText('Ask our team');
    await expect(ways.nth(3)).toContainText('No website needed.');
});

test('Way 1: send a code (free mail refused), then enter it', async ({ page }) => {
    await open(page, 'case=waiting');
    const way = page.getByTestId('verify-way-email');
    await way.getByRole('button', { name: 'Use email' }).click();
    await way.getByLabel(/Email on your organization’s domain/).fill('me@gmail.com');
    await way.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByTestId('org-verified-badge').getByRole('alert')).toContainText('not Gmail, Outlook or the like');
    await way.getByLabel(/Email on your organization’s domain/).fill('hod@rvce.edu.in');
    await way.getByRole('button', { name: 'Send code' }).click();
    expect(await calls(page)).toContainEqual(['emailCode', 'org', 'hod@rvce.edu.in']);
    await open(page, 'case=email');
    const card = page.getByTestId('org-verified-badge');
    await expect(card).toContainText('Enter the code sent to h…@rvce.edu.in');
    await expect(card).toContainText(/Resend in 0:0\d/);
    await card.getByLabel('6-digit code').fill('111111');
    await card.getByRole('button', { name: 'Verify' }).click();
    await expect(card.getByRole('alert')).toHaveText('That code isn’t right. 4 tries left.');
    await card.getByLabel('6-digit code').fill('424242');
    await card.getByRole('button', { name: 'Verify' }).click();
    expect(await calls(page)).toContainEqual(['confirm', 'org', '424242']);
    await expect(card.getByRole('button', { name: 'Use a different address or resend' })).toBeVisible({ timeout: 6000 });
});

test('Ways 2–4: ask the parent, check the code, and ask the team with a document', async ({ page }) => {
    await open(page, 'case=listed');
    const parent = page.getByTestId('verify-way-parent');
    await expect(parent).toContainText('Northgate Institute is verified here. One of its admins confirms you.');
    await parent.getByRole('button', { name: /Ask/ }).first().click();
    await parent.getByRole('button', { name: 'Ask Northgate Institute' }).click();
    expect(await calls(page)).toContainEqual(['askParent', 'org']);

    await open(page, 'case=waiting');
    const unlinked = page.getByTestId('verify-way-parent');
    await unlinked.getByRole('button', { name: 'Link Part of' }).click();
    await unlinked.getByRole('button', { name: 'Go to Organization profile' }).click();
    expect(await opened(page)).toEqual(['org-profile']);

    const code = page.getByTestId('verify-way-code');
    await code.getByRole('button', { name: 'Get code' }).click();
    await expect(code).toContainText('networkbase-verify-0123456789abcdef0123');
    await code.getByRole('button', { name: 'Check DNS' }).click();
    await expect(page.getByTestId('org-verified-badge').getByRole('alert')).toContainText('DNS changes can take up to an hour.');
    await code.getByRole('button', { name: 'Add it in Links' }).click();
    expect(await opened(page)).toContain('links');

    const team = page.getByTestId('verify-way-team');
    await team.getByRole('button', { name: 'Ask' }).click();
    await expect(team.getByRole('button', { name: 'Send request' })).toBeDisabled();
    await team.getByLabel('Who you are, and how we can check it').fill('I teach CSE 3B at Northgate Institute; the department office can confirm.');
    await team.getByLabel(/Links that show it/).fill('https://northgate.edu/cse');
    await team.getByLabel(/A document \(optional\)/).setInputFiles({ name: 'letter.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect(team).toContainText('Only the NetworkBase team sees it, and the document is deleted 30 days after we decide.');
    await team.getByRole('button', { name: 'Send request' }).click();
    await expect.poll(() => calls(page)).toContainEqual(['team', 'org', { explanation: 'I teach CSE 3B at Northgate Institute; the department office can confirm.', links: 'https://northgate.edu/cse', document: 'letter.pdf' }]);
});

test('Badge states: waiting for the parent, requested, verified with what it was checked against, declined; admins read only', async ({ page }) => {
    await open(page, 'case=parent');
    const card = () => page.getByTestId('org-verified-badge');
    await expect(card()).toContainText('Waiting for Northgate Institute to confirm it.');
    await card().getByRole('button', { name: 'Try another way' }).click();
    expect(await calls(page)).toContainEqual(['cancel', 'org']);
    await open(page, 'case=team');
    await expect(card()).toContainText('Requested. The NetworkBase team will review it.');
    await expect(card().getByRole('listitem')).toHaveCount(0);
    await open(page, 'case=verified');
    await expect(card()).toContainText('Verified · rvce.edu.in · since Nov 5, 2026');
    await expect(card().getByRole('listitem')).toHaveCount(0);
    await open(page, 'case=declined');
    await expect(card()).toContainText('Not verified this time. We couldn’t reach the department. Try another way below.');
    await expect(card().getByRole('listitem')).toHaveCount(4);
    await open(page, 'case=waiting&role=admin');
    await expect(card()).toContainText('The owner can ask for this.');
    await expect(card().getByRole('button')).toHaveCount(0);
});

test('phone width and axe: no sideways scroll; no WCAG A or AA problems in the main states', async ({ page }) => {
    for (const state of ['waiting', 'listed', 'email', 'verified']) {
        await open(page, `case=${state}`, 375);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        expect(await axeViolations(page)).toEqual([]);
    }
    await open(page, 'case=waiting', 1100);
    await page.getByTestId('verify-way-team').getByRole('button', { name: 'Ask' }).click();
    await page.getByTestId('verify-way-code').getByRole('button', { name: 'Get code' }).click();
    expect(await axeViolations(page)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('discovery-1100.png'), fullPage: true });
});
