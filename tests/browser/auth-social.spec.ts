import { serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';

// Google and GitHub get the same Cloudflare check as the email form
// (docs/superpowers/plans/2026-11-09-social-login-cloudflare-findings.md), against the real forms and stylesheet.
const origin = 'https://auth-social.test';
let script: string, css: string;

test.beforeAll(async () => {
    const mocks: Record<string, string> = {
        'next/link': `import React from 'react';export default ({href,children,prefetch,...p})=>React.createElement('a',{href,...p},children);`,
        'next/navigation': `export const useRouter=()=>({push(){},replace(){},refresh(){}});export const usePathname=()=>'/login';export const useSearchParams=()=>new URLSearchParams();`,
        'next/script': `import {useEffect} from 'react';export default function Script({onReady,onLoad}){useEffect(()=>{onReady?.();onLoad?.();},[]);return null;}`,
        '@/components/providers/SecurityRuntimeProvider': `export const useSecurityRuntime=()=>({nonce:null});`,
        '@/lib/supabase/client': `export const createClient=()=>({auth:{
            signInWithOAuth:async({provider,options})=>{window.oauth={provider,redirectTo:options.redirectTo};return {data:{url:null},error:null};},
            onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
            getSession:async()=>({data:{session:null}}),
        }});`,
    };
    const bundle = await build({
        entryPoints: [path.resolve('tests/browser/auth-social.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser',
        define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY': '"test-site-key"', 'process.env': '{}' },
        plugins: [{ name: 'auth-social-boundaries', setup(builder) {
            builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
        } }, serverActionsPlugin],
    });
    script = bundle.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, query: string, check: { pass: boolean } = { pass: true }) {
    const posts: Array<{ captchaToken: string; rid: string }> = [];
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.route(origin + '/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/v1/auth/human-check') {
            posts.push(route.request().postDataJSON());
            return route.fulfill({ status: check.pass ? 200 : 400, contentType: 'application/json', body: JSON.stringify(check.pass ? { success: true, data: { passed: true } } : { success: false, message: 'The security check didn’t pass. Wait for a new check, then try again.' }) });
        }
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html lang="en"><head><title>Sign in</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?${query}`);
    await page.getByRole('button', { name: 'GitHub' }).waitFor();
    return posts;
}

for (const form of ['login', 'signup']) {
    test(`${form}: one check sits above Google and GitHub, and the email form uses the same one`, async ({ page }) => {
        await open(page, `page=${form}`);
        const checkBox = page.getByText('Cloudflare check');
        await expect(checkBox).toHaveCount(1);
        expect((await checkBox.boundingBox())!.y).toBeLessThan((await page.getByRole('button', { name: 'Google' }).boundingBox())!.y);
    });
}

test('a button waits for the check: before it passes, it asks for it and goes nowhere', async ({ page }) => {
    const posts = await open(page, 'page=login&hold=1');
    await page.getByRole('button', { name: 'Google' }).click();
    await expect(page.getByText('Complete the security check first.')).toBeVisible();
    expect(posts).toHaveLength(0);
    expect(await page.evaluate(() => (window as { oauth?: unknown }).oauth)).toBeUndefined();
});

test('after the check, the server is asked first and the pass is tied to this attempt’s return address', async ({ page }) => {
    const posts = await open(page, 'page=signup');
    await page.getByRole('button', { name: 'GitHub' }).click();
    await expect.poll(() => page.evaluate(() => (window as { oauth?: unknown }).oauth)).toBeTruthy();
    const oauth = await page.evaluate(() => (window as unknown as { oauth: { provider: string; redirectTo: string } }).oauth);
    expect(oauth.provider).toBe('github');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.captchaToken).toBe('token-1');
    expect(new URL(oauth.redirectTo).searchParams.get('rid')).toBe(posts[0]!.rid);
});

test('when the server turns the check down, the person is told, Google is never opened and a fresh check starts', async ({ page }) => {
    const posts = await open(page, 'page=login', { pass: false });
    await page.getByRole('button', { name: 'Google' }).click();
    await expect(page.getByText('The security check didn’t pass. Wait for a new check, then try again.')).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(await page.evaluate(() => (window as { oauth?: unknown }).oauth)).toBeUndefined();
    await expect.poll(() => page.evaluate(() => (window as { renders?: number }).renders)).toBe(2);
});
