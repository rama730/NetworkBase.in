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
        // A stand-in for Supabase: the password picks the answer ("wrong", "unconfirmed", "mfa"), code 123456 is right.
        '@/lib/supabase/client': `const session={access_token:'a',refresh_token:'r',user:{app_metadata:{}}};export const createClient=()=>({auth:{
            signInWithOAuth:async({provider,options})=>{window.oauth={provider,redirectTo:options.redirectTo};return {data:{url:null},error:null};},
            signInWithPassword:async({password})=>{window.mfa=password==='mfa';return password==='wrong'?{data:{user:null,session:null},error:{message:'Invalid login credentials'}}:password==='unconfirmed'?{data:{user:null,session:null},error:{message:'Email not confirmed'}}:{data:{user:{id:'u'},session},error:null};},
            mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal1',nextLevel:window.mfa?'aal2':'aal1'}})},
            verifyOtp:async(p)=>{(window.verified=window.verified||[]).push(p);return p.token==='123456'?{data:{session,user:{id:'u'}},error:null}:{data:{session:null,user:null},error:{message:'bad'}};},
            resend:async()=>({error:null}),
            onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
            getSession:async()=>({data:{session}}),
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
    const posts: Array<Record<string, string>> = [];
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.route(origin + '/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/v1/auth/session') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
        if (url.pathname === '/api/v1/auth/trusted-browser') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"signedIn":false}}' });
        if (url.pathname === '/api/v1/auth/email-code') {
            posts.push(route.request().postDataJSON());
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"sent":true}}' });
        }
        if (url.pathname === '/api/v1/auth/signup') {
            const used = route.request().postDataJSON().email === 'used@test.local';
            return route.fulfill({ status: used ? 409 : 200, contentType: 'application/json', body: JSON.stringify(used ? { success: false, message: 'This email has already been used to create an account' } : { success: true, data: { user: { id: 'u' } } }) });
        }
        if (url.pathname === '/api/v1/auth/human-check') {
            posts.push(route.request().postDataJSON());
            return route.fulfill({ status: check.pass ? 200 : 400, contentType: 'application/json', body: JSON.stringify(check.pass ? { success: true, data: { passed: true } } : { success: false, message: 'The security check didn’t pass. Wait for a new check, then try again.' }) });
        }
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html lang="en"><head><title>Sign in</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?${query}`);
    await page.locator('h1').waitFor();
    return posts;
}

for (const form of ['login', 'signup']) {
    test(`${form}: one check sits above Google and GitHub, takes no room unless Cloudflare needs a click`, async ({ page }) => {
        await open(page, `page=${form}`);
        const checkBox = page.getByText('Cloudflare check');
        await expect(checkBox).toHaveCount(1);
        const box = (await checkBox.boundingBox())!;
        expect(box.height).toBe(0);
        expect(box.y).toBeLessThanOrEqual((await page.getByRole('button', { name: 'Google' }).boundingBox())!.y);
    });
}

test('a button waits for the check: before it passes, it asks for it and goes nowhere', async ({ page }) => {
    const posts = await open(page, 'page=login&hold=1');
    await page.getByRole('button', { name: 'Google' }).click();
    await expect(page.getByText('Finish the security check first. It usually takes a second.')).toBeVisible();
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

// The sign-in pages' findings (docs/superpowers/plans/2026-11-09-auth-pages-findings.md).
const verified = (page: Page) => page.evaluate(() => (window as unknown as { verified?: Array<{ type: string; token: string }> }).verified ?? []);

test('B16, B10: three wrong passwords offer a code or a reset; a Google account is told to use Google', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('nb_last_sign_in', 'google'));
    await open(page, 'page=login');
    await expect(page.getByRole('button', { name: /Google/ }).getByText('Last used')).toBeVisible();
    await page.getByLabel('Email').fill('me@test.local');
    await page.getByLabel('Password', { exact: true }).fill('wrong');
    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText(/You last signed in with Google/)).toBeVisible();
    await expect(page.getByRole('group', { name: 'Other ways in' }).getByRole('button', { name: 'Email me a code' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reset password' })).toBeVisible();
});

test('A4: an unconfirmed email gets the code box right there, not a dead end', async ({ page }) => {
    await open(page, 'page=login');
    await page.getByLabel('Email').fill('new@test.local');
    await page.getByLabel('Password', { exact: true }).fill('unconfirmed');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirm your email first' })).toBeVisible();
    await page.getByLabel('Confirmation code').fill('123456');
    await expect.poll(() => verified(page)).toEqual([{ email: 'new@test.local', token: '123456', type: 'signup' }]);
});

test('B11, D20: "Email me a sign-in code" sends a code, shows the box and an Open Gmail button', async ({ page }) => {
    const posts = await open(page, 'page=login');
    await page.getByLabel('Email').fill('me@gmail.com');
    await page.getByRole('button', { name: 'Email me a sign-in code instead' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    expect(posts.at(-1)).toMatchObject({ email: 'me@gmail.com', purpose: 'sign-in', captchaToken: 'token-1' });
    await expect(page.getByRole('link', { name: /Open Gmail/ })).toHaveAttribute('target', '_blank');
    await page.getByLabel('Sign-in code').fill('123456');
    await expect.poll(() => verified(page)).toEqual([{ email: 'me@gmail.com', token: '123456', type: 'magiclink' }]);
});

test('A3, C18: the code screen offers "Trust this browser for 30 days" and a recovery code for a lost device', async ({ page }) => {
    await open(page, 'page=login');
    await page.getByLabel('Email').fill('me@test.local');
    await page.getByLabel('Password', { exact: true }).fill('mfa');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
    await expect(page.getByLabel('Trust this browser for 30 days')).toBeVisible();
    await page.getByRole('button', { name: 'Lost your device?' }).click();
    await expect(page.getByRole('heading', { name: 'Use a recovery code' })).toBeVisible();
    await expect(page.getByLabel('Recovery code')).toBeVisible();
});

test('A1: a failed GitHub return says GitHub, with no developer hint', async ({ page }) => {
    await open(page, 'page=login&error=github-failed');
    await expect(page.getByText('GitHub sign-in didn’t finish. Try again.')).toBeVisible();
});

test('B8, B9, A6: sign-up has no confirm-password or handle check, and a used email shows the ways forward', async ({ page }) => {
    await open(page, 'page=signup');
    await expect(page.getByLabel('Confirm password')).toHaveCount(0);
    await expect(page.getByText(/Your profile link/)).toHaveCount(0);
    await expect(page.getByText(/By continuing with Google or GitHub, you confirm you’re 18 or older/)).toBeVisible();
    await page.getByLabel('Full name').fill('Asha Rao');
    await page.getByLabel('Email').fill('used@test.local');
    await page.getByLabel('Password', { exact: true }).fill('Str0ng-enough-pass!');
    await page.getByRole('checkbox', { name: /I am at least 18/ }).check();
    await page.getByRole('button', { name: /Create account/ }).click();
    await expect(page.getByText('You already have an account with this email')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in instead' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reset your password' })).toBeVisible();
});

test('A5: the sign-up code step survives a reload', async ({ page }) => {
    await open(page, 'page=signup');
    await page.getByLabel('Full name').fill('Asha Rao');
    await page.getByLabel('Email').fill('asha@test.local');
    await page.getByLabel('Password', { exact: true }).fill('Str0ng-enough-pass!');
    await page.getByRole('checkbox', { name: /I am at least 18/ }).check();
    await page.getByRole('button', { name: /Create account/ }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByText('asha@test.local')).toBeVisible();
});

test('A2: forgot password sends a code that works on any device, checked as a recovery code', async ({ page }) => {
    const posts = await open(page, 'page=forgot');
    await page.getByLabel('Email').fill('me@test.local');
    await page.getByRole('button', { name: 'Send reset code' }).click();
    await expect(page.getByText(/Both work on any device/)).toBeVisible();
    expect(posts.at(-1)).toMatchObject({ email: 'me@test.local', purpose: 'reset' });
    await page.getByLabel('Reset code').fill('123456');
    await expect.poll(() => verified(page)).toEqual([{ email: 'me@test.local', token: '123456', type: 'recovery' }]);
});
