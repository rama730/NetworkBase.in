import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';

// Organization creation (report §34) against the real wizard parts and stylesheet.
const origin = 'https://org-create.test';
let script: string, css: string;

test.beforeAll(async () => {
    const mocks: Record<string, string> = {
        'next/link': `import React from 'react';export default ({href,children,prefetch,...p})=>React.createElement('a',{href,...p},children);`,
        'next/navigation': `export const usePathname=()=>'/workspaces/new',useRouter=()=>({refresh(){},push(){},replace(){}});`,
        '@/app/actions/organizations': `export const checkOrgHandleAction=async(h)=>({available:h!=='taken',message:h==='taken'?'@taken is taken.':'@'+h+' is free.',handle:h}),childTitleTakenAction=async()=>false;`,
        '@/components/organizations/people-search': `export const findPeople=async(q)=>[{id:'11111111-1111-4111-8111-111111111111',name:'Kiran Rao',username:'kiran'}].filter(p=>p.name.toLowerCase().includes(q.toLowerCase()));`,
        '@/components/skills/SkillPicker': `export const SkillPicker=()=>null;`,
        '@/hooks/useAuth': `export const useAuth=()=>({user:{user_metadata:{full_name:'Ms. Rao'}}});`,
        '@/components/messages/message-user': `export const messageUserInWindow=()=>false;`,
    };
    const bundle = await build({ entryPoints: [path.resolve('tests/browser/org-create.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'org-create-boundaries', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }] });
    script = bundle.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, query: string, width = 1200) {
    await page.setViewportSize({ width, height: 900 });
    await page.route(origin + '/**', route => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?${query}`);
}
const values = (page: Page) => page.evaluate(() => (window as unknown as { form: { getValues: () => Record<string, unknown> } }).form.getValues()) as Promise<{ organization: Record<string, unknown>; visibility?: string; member_updates_enabled?: boolean }>;

test('Start: nothing is picked, Other asks for its name, and the type sets defaults', async ({ page }) => {
    await open(page, 'step=type');
    await expect(page.getByTestId('create-org-type-required')).toBeVisible();
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(page.getByText('PI · Researcher · Member · Viewer')).toBeVisible();
    await page.getByText('A class, batch or semester').click();
    let v = await values(page);
    expect([v.organization.org_type, v.organization.join_mode, v.visibility, v.member_updates_enabled, (v.organization.role_names as { member: string }).member]).toEqual(['education', 'instant', 'private', false, 'Student']);
    await page.getByText('Anything else: a nonprofit, an event, a government team').click();
    await expect(page.getByLabel(/What do you call it/)).toBeVisible();
    await page.getByLabel(/What do you call it/).fill('Nonprofit');
    v = await values(page);
    expect([v.organization.org_type, v.organization.type_label, v.organization.join_mode, v.visibility]).toEqual(['other', 'Nonprofit', 'approval', 'private']);
    // Keyboard: the type cards are radios you can reach and pick.
    await page.getByRole('radio', { name: /Club/ }).focus();
    await page.keyboard.press('Space');
    expect((await values(page)).organization.org_type).toBe('club');
});

test('Details: organization words, Part of and Where, no problem/solution or skills', async ({ page }) => {
    await open(page, 'step=details&type=education');
    await expect(page.getByRole('heading', { name: 'Organization details' })).toBeVisible();
    for (const label of ['Subject', 'Name', 'Organization URL', 'Part of', 'Where', 'Time zone', 'About', "Who it’s for", 'What members do here', 'Welcome note', 'Topics']) {
        await expect(page.getByLabel(label, { exact: false }).first()).toBeVisible();
    }
    await expect(page.getByText('Problem statement')).toHaveCount(0);
    await expect(page.getByText('Workspace category')).toHaveCount(0);
    await expect(page.getByPlaceholder('Students of B.Tech CSE, 3rd semester, Section A')).toBeVisible();
    await page.locator('#create-project-title').fill('CSE-3A 2026');
    await expect(page.getByLabel(/Organization URL/)).toHaveValue('cse-3a-2026');
    expect((await values(page)).organization.time_zone).toBeTruthy();
});

test('People: role names, a co-admin by search and by email, and the roster count', async ({ page }) => {
    await open(page, 'step=people&type=research');
    await page.getByLabel('Name for the member role').fill('Scholar');
    await page.getByLabel('Co-admins (optional)').fill('kir');
    await page.getByRole('button', { name: /Kiran Rao/ }).click();
    await page.getByLabel('Co-admins (optional)').fill('dean@example.com');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Co-admins' }).getByRole('listitem')).toHaveCount(2);
    await page.getByLabel('Invite people now (optional)').fill('a@x.edu, b@x.edu; nope');
    await expect(page.getByText('2 emails, 1 looks wrong')).toBeVisible();
    const v = await values(page);
    expect((v.organization.role_names as { member: string }).member).toBe('Scholar');
    expect((v.organization.co_admins as Array<{ email?: string }>).map((a) => a.email ?? 'id')).toEqual(['id', 'dean@example.com']);
});

test('Setup: the calendar and Work defaults follow the type and can change', async ({ page }) => {
    await open(page, 'step=setup&type=education');
    await expect(page.getByTestId('create-org-work-summary')).toContainText('Review on · Late work accepted until a date');
    await page.getByRole('button', { name: 'Change' }).click();
    await page.getByLabel('Late work').selectOption('none');
    await expect(page.getByTestId('create-org-work-summary')).toContainText('Late work not accepted');
    await expect(page.getByText('Term (optional)')).toBeVisible();
    await page.getByLabel('Plan a series of sprints now').check();
    expect(((await values(page)).organization.plan_sprints as { prefix: string }).prefix).toBe('CO');
});

test('Done: the code, what was sent, and an invite message in your name', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await open(page, 'step=done', 375);
    await expect(page.getByTestId('org-created-invites')).toContainText('1 co-admin invite and 62 member invites sent');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
