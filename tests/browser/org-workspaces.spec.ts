import { serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from './axe';

// Organization → Workspaces (docs/superpowers/plans/2026-11-04-org-workspaces-tab-findings.md): the header, Discover's
// card with the organization's part, List, each flow and state, phones and axe — the real tab against mocked reads.
const origin = 'https://org-workspaces.test';
let script: string, css: string;

test.beforeAll(async () => {
    const W = 'window.ws';
    const mocks: Record<string, string> = {
        'next/link': `import React from 'react';export default ({href,children,prefetch,...p})=>React.createElement('a',{href,...p},children);`,
        '@/hooks/useAuth': `export const useAuth=()=>({user:{id:${W}.mode==='member'?'me':'u-admin'}});`,
        '@/hooks/workspaces/useUserInteractions': `export const useUserFollowedWorkspaces=()=>new Set();`,
        '@/hooks/workspaces/useMyApplicationStates': `export const useMyApplicationStates=()=>new Map();`,
        '@/hooks/useWorkspaceLiveCounts': `export const useWorkspaceCardLive=()=>{};`,
        '@/hooks/mutations/useWorkspaceMutations': `export const useToggleWorkspaceFollow=()=>({mutateAsync:async()=>({})});`,
        '@/lib/skills/client': `export const useSkillCatalog=()=>null;export const resolveClientSkill=name=>({name,canonicalKey:name.toLowerCase()});`,
        '@/components/skills/SkillIcon': `export const SkillIcon=()=>null;`,
        '@/components/reports/ReportDialog': `export const ReportDialog=()=>null;export const ReportMenuItem=()=>null;`,
        '@/lib/realtime/private-broadcast': `export const subscribeBroadcast=()=>({unsubscribe(){}});`,
        '@/components/messages/message-user': `export const messageUserInWindow=()=>false;`,
        '@/components/workspaces/WorkspaceLastUpdate': `import React from 'react';export const WorkspaceLastUpdate=({className,timeOnly})=>React.createElement('span',{className,'data-testid':'workspace-last-update'},timeOnly?'3h ago':'Updated by Rama · 3h ago');`,
        '@/app/actions/org-dashboard': `
            const day=864e5, iso=(ago)=>new Date(Date.now()-ago).toISOString();
            const base={visibility:'org',status:'active',coverImage:null,units:1,open:2,overdue:0,inReview:0,groupCopy:null,groupCopyIds:null,reasons:[],mine:false,stage:null,sprint:null,newInOrg:false,openSeats:0,needsLead:false,archivedBy:null,description:null,skills:[],people:[],externalLinks:null,githubRepoUrl:null,views:12,followers:2,remindedAt:null,addedAt:iso(30*day),lastActivityAt:iso(36e5)};
            const p=(id,name)=>({id,name,username:null,avatarUrl:null});
            const admin=[
              {...base,id:'falcon',title:'Team Falcon',slug:'falcon',visibility:'public',lead:{id:'l1',name:'Ramanayudu CH'},members:5,open:4,inReview:1,mine:true,stage:'Plan',sprint:{name:'CO1 · Week 3–4',inOrgSprint:true},description:'A tiny compiler for a teaching language',skills:['React','TypeScript'],people:[p('l1','Ramanayudu CH'),p('u2','Asha Nair'),p('u3','Kiran')],groupCopy:{title:'ALM-1',state:'submitted'},groupCopyIds:{copyId:'c1',masterId:'m1'},openSeats:1,addedAt:iso(10*day)},
              {...base,id:'osprey',title:'Team Osprey',slug:'osprey',lead:{id:'l2',name:'Priya'},members:4,open:5,overdue:3,reasons:['3 overdue','quiet 7 days'],lastActivityAt:iso(8*day),people:[p('l2','Priya')]},
              {...base,id:'kestrel',title:'Team Kestrel',slug:'kestrel',visibility:'private',lead:{id:'l3',name:'Meena'},members:2,people:[p('l3','Meena'),p('u9','Ravi')],newInOrg:true,needsLead:true,addedAt:iso(36e5)},
              {...base,id:'old',title:'Team Old',slug:'old',status:'archived',lead:{id:'l4',name:'John'},members:3,archivedBy:{name:'Rama',admin:true,at:'2026-11-02T10:00:00.000Z'}},
            ];
            const member=admin.filter(r=>r.status!=='archived'&&r.visibility!=='private').map(r=>({...r,reasons:[],remindedAt:null,mine:r.id==='falcon',lead:r.id==='falcon'?{id:'me',name:'Me'}:r.lead,openSeats:r.id==='osprey'?2:r.openSeats}));
            export const readOrgWorkspacesAction=async()=>{
              const m=${W}.mode; ${W}.reads=(${W}.reads||0)+1;
              if(m==='error') return {success:false,error:'nope'};
              const rows=m==='empty'?[]:m==='member'?member:admin;
              return {success:true,isAdmin:m!=='member',canCreate:m!=='member',canAsk:m==='member',orgArchived:false,rows,
                requests:m==='admin'?[{id:'heron',title:'Team Heron',slug:null,kind:'move_in',lead:'Asha',members:3,at:null}]:[],
                summary:{total:0,attention:0,quiet:0,archived:0,mine:0,notInProject:m==='admin'?1:0}};
            };
            export const remindLeadsAction=async(orgId,ids,note)=>{${W}.calls.push(['remind',ids,note]);return {success:true,reminded:ids.length,skipped:0,ids};};
            export const readMyMovableWorkspacesAction=async()=>({success:true,rows:[{id:'side',title:'My Side Project',asked:false}]});`,
        '@/app/actions/organizations': ['approveMoveInAction', 'archiveChildAction', 'assignChildLeadAction', 'cancelDetachRequestAction', 'cancelMoveInAction', 'detachChildAction', 'unarchiveChildAction']
            .map((n) => `export const ${n}=async(...a)=>{${W}.calls.push(['${n}',...a]);return {success:true};};`).join('')
            + `export const moveWorkspaceToOrgAction=async(...a)=>{${W}.calls.push(['move',...a]);return {success:true,outcome:'requested'};};export const readLeadCandidatesAction=async()=>({success:true,people:[{id:'u2',name:'Asha Nair',onTeam:true}]});`,
    };
    const bundle = await build({ entryPoints: [path.resolve('tests/browser/org-workspaces.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'org-workspaces-boundaries', setup(b) {
        b.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }, serverActionsPlugin] });
    script = bundle.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, { mode = 'admin', width = 1280, query = '' }: { mode?: string; width?: number; query?: string } = {}) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((m) => { (window as unknown as { ws: object }).ws = { mode: m, calls: [] }; }, mode);
    await page.route(origin + '/**', route => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html lang="en"><head><title>Workspaces</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?tab=projects${query}`);
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as { ws: { calls: unknown[] } }).ws.calls);
const card = (page: Page, title: string) => page.getByRole('list', { name: 'Workspaces' }).getByRole('listitem').filter({ hasText: title });
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test('header: requests line, status bar with counts, Place them, and one 30px toolbar ending in New workspace', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('tab', { name: 'All, 3' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Needs attention, 2' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Archived, 1' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Place them' })).toHaveAttribute('href', '/org/cse-3b?tab=members&project=none&from=workspaces');
    const controls = [page.getByLabel('Search workspaces'), page.getByLabel('Sort'), page.getByRole('button', { name: 'Mine' }), page.getByRole('button', { name: 'Filters' }), page.getByRole('group', { name: 'View', exact: true }), page.getByRole('link', { name: 'New workspace' })]
    const boxes = await Promise.all(controls.map((c) => c.boundingBox()))
    for (const box of boxes) { expect(Math.round(box!.height)).toBe(30); expect(Math.abs(box!.y - boxes[0]!.y)).toBeLessThan(2) }
    expect(boxes[5]!.x).toBeGreaterThan(Math.max(...boxes.slice(0, 5).map((b) => b!.x + b!.width)))
    // F3: one line, the panel, and the line goes once answered.
    await expect(page.getByTestId('requests-line')).toContainText('1 workspace asked to join or leave');
    await page.getByRole('button', { name: 'Review' }).click();
    const panel = page.getByRole('dialog', { name: /Requests/ });
    await expect(panel).toContainText('Team Heron');
    await panel.getByRole('button', { name: 'Accept' }).click();
    await expect(panel).toBeHidden();
    expect(await calls(page)).toContainEqual(['approveMoveInAction', 'heron']);
});

test('cards: Discover’s card, full width, with the organization line, health, group work and each reason’s own fix', async ({ page }) => {
    await open(page);
    const items = page.getByRole('list', { name: 'Workspaces' }).getByRole('listitem');
    await expect(items).toHaveCount(3);
    // Needs attention first for admins: Osprey (2 reasons), Kestrel (1), Falcon.
    await expect(items.nth(0)).toContainText('Team Osprey');
    await expect(items.nth(2)).toContainText('Team Falcon');
    const falcon = card(page, 'Team Falcon');
    await expect(falcon.locator('article.nb-project-card')).toBeVisible();
    const list = await page.getByRole('list', { name: 'Workspaces' }).boundingBox();
    expect(Math.round((await falcon.boundingBox())!.width)).toBe(Math.round(list!.width));
    await expect(falcon).toContainText('A tiny compiler for a teaching language');
    await expect(falcon).toContainText('Updated by Rama · 3h ago');
    await expect(falcon.getByTestId('org-details')).toContainText('Lead Ramanayudu CH · Plan · CO1 · Week 3–4');
    await expect(falcon.getByRole('group', { name: /Health: 4 open, 0 overdue, 1 in review/ })).toBeVisible();
    await expect(falcon).toContainText('ALM-1 · ');
    await expect(falcon).toContainText('5 people');
    await expect(falcon.getByRole('link', { name: '1 open seat' })).toHaveAttribute('href', '/workspaces/falcon?tab=dashboard#teams');
    await expect(falcon).toContainText('Public');
    await expect(card(page, 'Team Osprey')).toContainText('Organization');
    const osprey = card(page, 'Team Osprey');
    await expect(osprey.getByTestId('attention-line')).toContainText('3 overdue · Open board');
    await expect(osprey.getByRole('link', { name: 'Open board' })).toHaveAttribute('href', '/workspaces/osprey?tab=tasks');
    // F1: Remind lead with an editable note, then "Reminded".
    await osprey.getByRole('button', { name: 'Remind workspace lead' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remind Priya' });
    await expect(dialog.getByLabel('Note')).toHaveValue(/Can you check on Team Osprey\? 3 overdue, Quiet 7 days/);
    await dialog.getByLabel('Note').fill('Post an update today, please');
    await dialog.getByRole('button', { name: 'Send reminder' }).click();
    await expect(osprey.getByTestId('attention-line')).toContainText('Reminded');
    expect(await calls(page)).toContainEqual(['remind', ['osprey'], 'Post an update today, please']);
    const kestrel = card(page, 'Team Kestrel');
    await expect(kestrel).toContainText('New');
    await kestrel.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByRole('dialog', { name: 'Assign a workspace lead for Team Kestrel' })).toBeVisible();
});

test('reason chips, archived cards and the place kept in the link', async ({ page }) => {
    await open(page);
    await page.getByRole('tab', { name: 'Needs attention, 2' }).click();
    await page.getByRole('group', { name: 'Reasons' }).getByRole('button', { name: /Quiet 7 days/ }).click();
    await expect(page.getByRole('list', { name: 'Workspaces' }).getByRole('listitem')).toHaveCount(1);
    expect(page.url()).toContain('ws=attention');
    expect(page.url()).toContain('wr=quiet');
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Needs attention, 2' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: /Quiet 7 days/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('tab', { name: 'Archived, 1' }).click();
    const old = card(page, 'Team Old');
    await expect(old).toContainText('Archived by Rama · Nov 2');
    expect(Number(await old.evaluate((el) => getComputedStyle(el).opacity))).toBeCloseTo(0.6, 1);
    await old.getByRole('button', { name: 'More actions for Team Old' }).click();
    await page.getByRole('menuitem', { name: 'Unarchive' }).click();
    await expect.poll(() => calls(page)).toContainEqual(['unarchiveChildAction', 'old']);
});

test('Archive asks, then offers Undo; Detach says what stays', async ({ page }) => {
    await open(page);
    await card(page, 'Team Falcon').getByRole('button', { name: 'More actions for Team Falcon' }).click();
    await page.getByRole('menuitem', { name: 'Detach' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Its people and files stay with it');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await card(page, 'Team Falcon').getByRole('button', { name: 'More actions for Team Falcon' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => calls(page)).toContainEqual(['unarchiveChildAction', 'falcon']);
});

test('List: columns, shift-click a range, the selection bar in the toolbar’s place, Esc clears', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'List' }).click();
    expect(page.url()).toContain('wview=list');
    const table = page.getByRole('table', { name: 'Workspaces' });
    for (const h of ['Name', 'Workspace lead', 'Stage', 'Health', 'Updated']) await expect(table.getByRole('columnheader', { name: h })).toBeVisible();
    await page.getByLabel('Select Team Osprey').click();
    await page.getByLabel('Select Team Falcon').click({ modifiers: ['Shift'] });
    const bar = page.getByRole('toolbar', { name: 'Selected workspaces' });
    await expect(bar).toContainText('3 selected');
    await expect(page.getByLabel('Search workspaces')).toHaveCount(0);
    await bar.getByRole('button', { name: 'Remind workspace leads' }).click();
    await expect(page.getByRole('dialog', { name: 'Remind 3 workspace leads' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.keyboard.press('Escape');
    await expect(bar).toBeHidden();
    await expect(page.getByLabel('Search workspaces')).toBeVisible();
});

test('members: Mine first, no attention, Message lead, Apply, and Ask to add a workspace', async ({ page }) => {
    await open(page, { mode: 'member' });
    await expect(page.getByRole('tab', { name: 'Mine, 1' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /Needs attention/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mine' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'All, 2' }).click();
    await expect(page.getByTestId('attention-line')).toHaveCount(0);
    const osprey = card(page, 'Team Osprey');
    await expect(osprey.getByRole('link', { name: 'Message workspace lead' })).toHaveAttribute('href', '/messages?userId=l2');
    await expect(osprey.getByRole('link', { name: '2 open seats · Apply' })).toBeVisible();
    await expect(card(page, 'Team Falcon').getByRole('link', { name: 'Message workspace lead' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Ask to add a workspace' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ask to add a workspace' });
    await dialog.getByRole('button', { name: 'Ask to join' }).click();
    await expect(dialog).toContainText('Asked');
    expect(await calls(page)).toContainEqual(['move', 'side', 'org']);
});

test('states: no workspaces, no match with Clear filters, and a failed read with Try again', async ({ page }) => {
    await open(page, { mode: 'empty' });
    await expect(page.getByRole('status').filter({ hasText: 'No workspaces yet.' })).toContainText('Teams work inside workspaces.');
    await expect(page.getByRole('link', { name: 'New workspace' }).first()).toBeVisible();
    await open(page, { query: '&wq=zzz' });
    await expect(page.getByText('No workspaces match these filters')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('list', { name: 'Workspaces' }).getByRole('listitem')).toHaveCount(3);
    await open(page, { mode: 'error' });
    await expect(page.getByRole('alert')).toContainText('Couldn’t load workspaces.');
    await page.evaluate(() => { (window as unknown as { ws: { mode: string } }).ws.mode = 'admin'; });
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('tab', { name: 'All, 3' })).toBeVisible();
});

test('keyboard: "/" goes to Search, Esc clears it, arrows move between status tabs', async ({ page }) => {
    await open(page);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(page.getByLabel('Search workspaces')).toBeFocused();
    await page.keyboard.type('osp');
    await expect(page.getByRole('list', { name: 'Workspaces' }).getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('status').filter({ hasText: 'Showing 1 of 3' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Search workspaces')).toHaveValue('');
    await page.getByRole('tab', { name: 'All, 3' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Needs attention, 2' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Needs attention, 2' })).toHaveAttribute('aria-selected', 'true');
});

test('phones and tablets: cards only on a phone, no sideways scroll, Search and New on the first line at 900px', async ({ page }) => {
    await open(page, { width: 390 });
    await expect(page.getByRole('list', { name: 'Workspaces' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'List' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'New', exact: true })).toBeVisible();
    const more = await card(page, 'Team Falcon').getByRole('button', { name: 'More actions for Team Falcon' }).boundingBox();
    expect(Math.min(more!.width, more!.height)).toBeGreaterThanOrEqual(44);
    await noSideScroll(page);
    await page.screenshot({ path: test.info().outputPath('workspaces-390.png'), fullPage: true });
    await open(page, { width: 900 });
    const search = await page.getByLabel('Search workspaces').boundingBox();
    const create = await page.getByRole('link', { name: 'New workspace' }).boundingBox();
    const sort = await page.getByLabel('Sort').boundingBox();
    expect(Math.abs(search!.y - create!.y)).toBeLessThan(2);
    expect(sort!.y).toBeGreaterThan(search!.y + 20);
    await noSideScroll(page);
});

test('axe: no WCAG A or AA problems in Cards, List, a member’s view, on a phone and in dark mode', async ({ page }) => {
    await open(page);
    await page.screenshot({ path: test.info().outputPath('workspaces-1280.png'), fullPage: true });
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole('button', { name: 'List' }).click();
    expect(await axeViolations(page)).toEqual([]);
    await open(page, { mode: 'member' });
    expect(await axeViolations(page)).toEqual([]);
    await open(page, { width: 390 });
    expect(await axeViolations(page)).toEqual([]);
    await open(page);
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.getByRole('tab', { name: 'Needs attention, 2' }).click();
    expect(await axeViolations(page)).toEqual([]);
});
