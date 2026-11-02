import { serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';

const origin = 'https://person-card.test';
let script: string, css: string, sans: Buffer, mono: Buffer;
test.use({ reducedMotion: 'reduce' });
test.beforeAll(async () => {
    const mocks: Record<string, string> = {
        'next/link': `import React from 'react';export default ({href,children,...p})=>React.createElement('a',{href,...p},children);`,
        'next/image': `import React from 'react';export default ({priority,fill,unoptimized,fetchPriority,...p})=>React.createElement('img',p);`,
        '@/components/messages/message-user': `export const messageUserInWindow=()=>true;`,
        '@/components/organizations/OrgRequestsSection': `export const useOrgRequests=()=>({data:null});export const OrgRequestsSection=()=>null;`,
        '@/hooks/useConnections': `const person={openToCollaborate:true,skills:['React','TypeScript'],mutualConnections:1};export const usePendingRequests=()=>({data:{incoming:[{id:'incoming',requesterId:'incoming-person',requesterUsername:'incoming',requesterFullName:'Incoming person',requesterHeadline:'Engineer',createdAt:new Date(),personCard:person}],sent:[{id:'sent',addresseeId:'sent-person',addresseeUsername:'sent',addresseeFullName:'Sent person',createdAt:new Date(),personCard:person}]},isLoading:false,isError:false});const resolve=async()=>{if(window.personCardFixture.decisionsFail)throw new Error('Request service unavailable');};export const useConnectionMutations=()=>({acceptRequest:{mutateAsync:resolve},rejectRequest:{mutateAsync:resolve},undoRejectRequest:{mutateAsync:resolve},withdrawAllSent:{mutateAsync:resolve},cancelRequest:{mutateAsync:resolve},blockProfile:{mutateAsync:resolve}});`,
        '@/hooks/useNetworkNotifications': `export const useNetworkNotifications=()=>({refresh:async()=>{}});`,
        '@/app/actions/network-invitations': `export const readNetworkInvitationsAction=async()=>({success:true,total:5,hasMore:false,nextCursor:null,items:[['incoming','connection','received','incoming-person','Incoming person'],['sent','connection','sent','sent-person','Sent person'],['project-invite','invitation','received','project-person','Project person'],['application','application','received','project-person','Project person'],['project-sent','invitation','sent','project-person','Project person']].map(([id,source,direction,personId,name])=>({id,source,direction,createdAt:new Date().toISOString(),note:null,projectId:'p',projectTitle:'Field Notes',projectSlug:'field-notes',roleTitle:'Designer',person:{id:personId,username:personId,fullName:name,headline:source==='connection'?'Engineer':'Designer',skills:['React','TypeScript'],openToCollaborate:true,mutualConnections:1}}))});`,
        '@/app/actions/workspace/guidance': `export const resolveWorkspaceInvitationAction=async()=>({success:!window.personCardFixture.decisionsFail,error:'Project service unavailable'});`,
        '@/app/actions/applications': `export const getApplicationAlignmentAction=async()=>({success:false});export const reopenApplicationAction=async()=>({success:true});export const withdrawApplicationAction=async()=>({success:true});const actor={id:'project-person',username:'project-person',fullName:'Project person',headline:'Designer',openToCollaborate:true,skills:['Figma']};export const getIncomingApplicationsAction=async()=>({success:true,applications:[{id:'project-invite',projectId:'p',projectTitle:'Field Notes',roleTitle:'Designer',actor,applicant:actor,status:'pending',isInvitation:true,createdAt:new Date()},{id:'application',projectId:'p',projectTitle:'Field Notes',roleTitle:'Engineer',actor,applicant:actor,status:'pending',isInvitation:false,createdAt:new Date()}]});export const getSentWorkspaceInvitationsAction=async()=>({success:true,invitations:[{id:'project-sent',invitationId:'project-sent',projectId:'p',projectTitle:'Field Notes',roleTitle:'Designer',candidate:actor,createdAt:new Date()}]});export const cancelSentWorkspaceInvitationAction=async()=>({success:true});export const acceptApplicationAction=async()=>({success:!window.personCardFixture.decisionsFail});export const rejectApplicationAction=async()=>({success:!window.personCardFixture.decisionsFail});`,
        '@/components/presence/usePresence': `export const useNow=()=>Date.now();export const usePersonPresence=()=>({loaded:true,availability:'now',availabilityText:'Active now',label:'Active now',status:null});export const useWorkspacePresence=()=>({availability:'offline',label:'Offline'});`,
        '@/app/actions/connections': `export const readPersonSharedConnectionsAction=async({offset=0})=>{window.personCardFixture.sharedCalls++;return window.personCardFixture.fail?{success:false,error:'Shared connection service unavailable'}:{success:true,summary:{targetIds:[],total:26,people:Array.from({length:offset?6:20},(_,i)=>({id:'peer-'+(offset+i),username:'peer'+(offset+i),fullName:'Peer '+(offset+i),avatarUrl:null}))}}};`,
    };
    const bundle = await build({ entryPoints: [path.resolve('tests/browser/person-card.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'person-card-boundaries', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }, serverActionsPlugin] });
    script = bundle.outputFiles![0]!.text;
    const compiled = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
    [sans, mono] = await Promise.all([readFile('src/app/fonts/InstrumentSans.woff2'), readFile('src/app/fonts/JetBrainsMono.woff2')]);
    css = `@font-face{font-family:Instrument;src:url('/sans.ttf');font-weight:100 900}@font-face{font-family:Mono;src:url('/mono.ttf');font-weight:100 900}:root{--font-instrument-sans:Instrument;--font-jetbrains-mono:Mono}` + compiled.css;
});
async function setup(page: Page) {
    page.on('pageerror', error => console.error(`Person card fixture: ${error.stack ?? error.message}`));
    await page.route(origin + '/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/skill-catalog.json') return route.fulfill({ body: await readFile('public/skill-catalog.json'), contentType: 'application/json' });
        if (/^\/skill-icons\/v1\/[a-zA-Z0-9._-]+\.(svg|png)$/.test(url.pathname)) return route.fulfill({ body: await readFile(path.join('public', url.pathname)), contentType: url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'image/png' });
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : url.pathname === '/sans.ttf' ? sans : url.pathname === '/mono.ttf' ? mono : '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
    });
    await page.goto(origin);
    await expect(page.locator('[data-slot=person-card]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
}

test('real person cards retain their geometry and hierarchy across sparse, dense, private and narrow states', async ({ page }) => {
    await setup(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const dark of [false, true]) {
        if (dark) await page.getByRole('button', { name: 'Theme', exact: true }).click();
        for (const rail of [false, true]) {
            if (rail) await page.getByRole('button', { name: 'Variant', exact: true }).click();
            for (const width of [266,288,320,404,469]) {
                await page.getByRole('spinbutton', { name: 'Width' }).fill(String(width));
                for (const kind of (await page.locator('select option').allTextContents()).filter(kind => kind !== 'invitations')) {
                    await page.getByRole('combobox', { name: 'Scenario' }).selectOption(kind);
                    await page.waitForTimeout(10);
                    const issues = await page.locator('[data-slot=person-card]').evaluate(card => {
                        const out: string[] = [];
                        if (card.getBoundingClientRect().height !== 176) out.push('height');
                        if (card.scrollHeight > card.clientHeight + 1) out.push('vertical overflow');
                        for (const row of card.querySelectorAll('.nb-person-identity,.nb-person-name-line,.nb-person-context,.nb-person-skill-strip,.nb-person-relationship')) {
                            const r = row.getBoundingClientRect();
                            for (const child of row.children) {
                                if (child.hasAttribute('data-measure')) continue;
                                const c = child.getBoundingClientRect();
                                if (c.width && c.height && (c.left < r.left - 1 || c.right > r.right + 1 || c.top < r.top - 1 || c.bottom > r.bottom + 1)) out.push(child.className + ': containment');
                            }
                        }
                        return out;
                    });
                    expect(issues, `${kind}, ${width}, rail=${rail}, dark=${dark}`).toEqual([]);
                    if (kind === 'complete' && ((!rail && width === 404 && !dark) || (rail && width === 320))) {
                        await page.locator('[data-slot=person-card]').screenshot({ path: test.info().outputPath(`person-card-${rail ? 'rail' : 'network'}-${dark ? 'dark' : 'light'}.png`) });
                    }
                }
            }
            if (rail) await page.getByRole('button', { name: 'Variant', exact: true }).click();
        }
    }
    expect(errors).toEqual([]);
});

test('skills and shared people disclose on demand, paginate safely, and restore keyboard focus', async ({ page }) => {
    await setup(page);
    expect(await page.evaluate(() => window.personCardFixture.sharedCalls)).toBe(0);
    const more = page.getByRole('button', { name: /Show \d+ more skills/ });
    await more.click();
    await expect(page.getByRole('dialog').locator('.nb-person-skill')).toHaveCount(8);
    await page.keyboard.press('Escape');
    await expect(more).toBeFocused();
    const shared = page.getByRole('button', { name: /6 mutual connections/ });
    await shared.click();
    await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(20);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(6);
    await page.keyboard.press('Escape');
    await expect(shared).toBeFocused();
    await page.getByRole('button', { name: 'Fail requests' }).click();
    await shared.click();
    await expect(page.getByRole('alert')).toContainText('unavailable');
    await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(0);
});

test('connection skills include canonical icons and disclose the complete list without growing the card', async ({page}) => {
    await setup(page);
    await page.getByRole('combobox', {name:'Scenario'}).selectOption('connected');
    await expect(page.locator('.nb-person-skill-strip > .nb-person-skill .nb-person-skill-icon').first()).toBeVisible();
    await expect(page.locator('.nb-person-skill-strip > .nb-person-skill .nb-person-skill-icon').first()).toHaveAttribute('style', /skill-icons/);
    await page.getByRole('button', {name:/Show \d+ more skills/}).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.nb-person-skill-label')).toHaveText(['React','TypeScript','Figma','Next.js','Node.js','PostgreSQL','Accessibility','Design Systems']);
    await expect(dialog.locator('.nb-person-skill-icon')).toHaveCount(6);
    for (const name of ['Accessibility', 'Design Systems']) {
        const skill = dialog.locator('.nb-person-skill').filter({hasText:name});
        await expect(skill).toHaveText(name);
        await expect(skill.locator('.nb-person-skill-icon')).toHaveCount(0);
    }
    await page.keyboard.press('Escape');
    expect((await page.locator('[data-slot=person-card]').boundingBox())!.height).toBe(176);
});

test('failed connection and review decisions preserve state and show visible feedback', async ({ page }) => {
    await setup(page);
    await page.getByRole('button', { name: 'Fail requests' }).click();
    await page.getByRole('button', { name: 'Connect with Mira Vale' }).click();
    await expect(page.getByRole('button', { name: 'Connect with Mira Vale' })).toBeEnabled();
    await page.getByRole('button', { name: 'Fail requests' }).click();
    await page.getByRole('button', { name: 'Connect with Mira Vale' }).click();
    await expect(page.getByRole('button', { name: 'Requested: options for Mira Vale' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Scenario' }).selectOption('review');
    await page.evaluate(() => { window.personCardFixture.decisionsFail = true; });
    await page.getByRole('button', { name: 'Review request from Mira Vale' }).click();
    await page.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Request service unavailable');
    await expect(page.getByRole('dialog')).toBeVisible();
});

test('touch cards keep 44px actions and mask private optional fields', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 740 }, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await setup(page);
    await page.getByRole('spinbutton', { name: 'Width' }).fill('266');
    expect((await page.locator('.nb-person-action button').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await page.locator('[data-slot=user-avatar]').boundingBox())!.width).toBe(40);
    await page.getByRole('combobox', { name: 'Scenario' }).selectOption('private');
    await expect(page.locator('.nb-person-collaboration,.nb-person-portfolio,.nb-person-shared,.nb-person-skill')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await context.close();
});


test('all invitation and application cards share the approved layout and failed decisions stay reviewable', async ({page}) => {
    await setup(page);
    await page.getByRole('combobox',{name:'Scenario'}).selectOption('invitations');
    await expect(page.locator('[data-slot=person-card]')).toHaveCount(5);
    await expect(page.getByRole('button',{name:/Review (request|application) from/})).toHaveCount(3);
    const heights=await page.locator('[data-slot=person-card]').evaluateAll(cards=>cards.map(card=>card.getBoundingClientRect().height));
    expect(heights).toEqual([176,176,176,176,176]);
    await page.evaluate(()=>{window.personCardFixture.decisionsFail=true;});
    await page.getByRole('button',{name:'Review request from Incoming person'}).click();
    await page.getByRole('button',{name:'Accept',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('could not be saved');
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Review request from Project person'}).first().click();
    await page.getByRole('button',{name:'Accept',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('could not be saved');
});
