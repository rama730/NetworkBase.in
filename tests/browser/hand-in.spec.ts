import { exportedNames, serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from './axe';

// Review UX phase 3 (findings 2.1–2.15, 4.6): the member's Hand in card in each state.
const origin = 'https://hand-in.test';
let script: string, css: string;
const ok = 'async()=>({success:true})';
const due = 'new Date(Date.now()+864e5).toISOString()';
const file = (id: string, name: string) => `{nodeId:'${id}',name:'${name}',size:2100000,projectId:'org'}`;
const base = `holder:true,submissionType:'file',reviewRequired:true,dueDate:${due},lateLabel:'Late work accepted',from:'CSE 3B',reviewers:'Teacher or TA',late:false,canSubmit:true,closed:false,
  approved:false,excusedReason:null,returned:null,latest:null,files:[],wouldBeLate:false,materials:[{nodeId:'m1',name:'rubric.pdf',projectId:'org'}],projectId:'org',maxFileBytes:10485760,
  steps:[{id:'s1',title:'Read the brief',done:true},{id:'s2',title:'Write the tests',done:false}],history:[]`;
const latest = (v: number) => `{version:${v},at:new Date(Date.now()-36e5).toISOString(),by:'Asha Nair',link:null,text:null,note:'Used Raft',files:[${file('v' + v, 'lab-v' + v + '.pdf')}]}`;
const copies: Record<string, string> = {
    open: `{${base},state:'not_started',files:[${file('w1', 'lab.pdf')}]}`,
    empty: `{${base},state:'not_started'}`,
    waiting: `{${base},state:'submitted',latest:${latest(2)},files:[${file('w1', 'lab.pdf')}],history:[{kind:'handed_in',at:new Date().toISOString(),by:'Asha Nair',version:2,late:false},{kind:'returned',at:new Date(Date.now()-864e5).toISOString(),by:'Ms. Rao',reason:'Add the test cases.'},{kind:'handed_in',at:new Date(Date.now()-2*864e5).toISOString(),by:'Asha Nair',version:1,late:false}]}`,
    returned: `{${base},submissionType:'link',state:'returned',returned:{reason:'Add the test cases.',fixBy:${due},by:'Ms. Rao'},latest:{...${latest(1)},link:'https://example.com/v1',files:[]}}`,
    text: `{${base},submissionType:'text',state:'in_progress',steps:[]}`,
    excused: `{${base},state:'excused',excusedReason:'Medical leave',canSubmit:false}`,
    closed: `{${base},state:'not_started',closed:true,canSubmit:false}`,
    admin: `{${base},holder:false,state:'submitted',latest:${latest(1)},orgId:'org',masterId:'a1'}`,
    approved: `{${base},state:'done',approved:true,canSubmit:false,latest:${latest(2)},history:[{kind:'approved',at:new Date().toISOString(),by:'Ms. Rao'},{kind:'handed_in',at:new Date(Date.now()-36e5).toISOString(),by:'Asha Nair',version:2,late:false}]}`,
};
const queueRow = (id: string, who: string) => `{kind:'copy',mine:true,copyId:'${id}',masterId:'a1',title:'Lab 3',who:'${who}',submittedBy:null,submittedAt:new Date().toISOString(),late:false,href:'?tab=tasks&drawerType=task&drawerId=${id}',
  projectId:'org',updatedAt:new Date().toISOString(),version:1,link:null,text:null,note:null,files:[],versions:[],steps:[],comments:0,left:false,dueDate:null}`;

test.beforeAll(async () => {
    const mocks: Record<string, string> = {
        'next/dynamic': `import React from 'react';export default (load)=>{const C=React.lazy(()=>load().then((m)=>({default:m.default??m})));return (p)=>React.createElement(React.Suspense,{fallback:null},React.createElement(C,p));};`,
        '@/components/workspaces/v2/preview/UniversalPreviewEngine': `import React from 'react';export default ({node,fileUrl})=>React.createElement('div',{title:'Preview of '+node.name,'data-url':fileUrl},node.name);`,
        '@/app/actions/files/nodes': `export const getNodesByIds=async(p,ids)=>ids.map((id)=>({id,name:id,type:'file',mimeType:null}));`,
        '@/app/actions/files/content': `export const getFilePreviewUrl=async(p,n,d)=>({url:'/files/'+n+(d?'?download=1':'')});`,
        '@/app/actions/assignments': `const copies={${Object.entries(copies).map(([k, v]) => `${k}:${v}`).join(',')}};
            export const readHandInAction=async(id)=>({success:true,handIn:copies[id]});export const submitAssignmentAction=${ok};
            export const readReviewQueueAction=async()=>({success:true,total:2,recentReasons:['Add the test cases.'],rows:[${queueRow('admin', 'Asha Nair')},${queueRow('c9', 'Kiran')}]});
            export const reviewAssignmentCopyAction=${ok};`,
        '@/app/actions/subtask': `export const toggleSubtaskAction=${ok};`,
    };
    for (const [spec, source] of [['@/app/actions/assignments', 'src/app/actions/assignments.ts'], ['@/app/actions/files/content', 'src/app/actions/files/content.ts'], ['@/app/actions/files/nodes', 'src/app/actions/files/nodes.ts'], ['@/app/actions/subtask', 'src/app/actions/subtask.ts']] as const) {
        const own = new Set(exportedNames(mocks[spec]!));
        mocks[spec] += exportedNames(await readFile(source, 'utf8')).filter((n) => !own.has(n)).map((n) => `export const ${n}=async()=>({success:false,error:'Not in this fixture'});`).join('');
    }
    const out = await build({ entryPoints: [path.resolve('tests/browser/hand-in.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'hand-in', setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }, serverActionsPlugin] });
    script = out.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, copy: string, width = 1280) {
    await page.setViewportSize({ width, height: 900 });
    await page.route(origin + '/**', (route) => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html lang="en"><head><title>Hand in</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?copy=${copy}`);
    return page.getByRole('region', { name: 'Hand in' });
}

test('2.3, 2.4, 2.7, 2.8, 4.6: open work shows what is asked on its own lines, one box with the next step, materials, files with Preview, and the steps', async ({ page }) => {
    const card = await open(page, 'open');
    await expect(card.getByText('What’s asked')).toBeVisible();
    await expect(card.getByRole('definition').filter({ hasText: 'Teacher or TA' })).toBeVisible();
    await expect(card.getByRole('status')).toContainText('Not handed in yet');
    await expect(card.getByRole('status')).toContainText('Add your file below, then hand it in.');
    await expect(card.getByRole('list', { name: 'Materials' })).toContainText('rubric.pdf');
    await card.getByRole('button', { name: 'Preview rubric.pdf' }).click();
    await expect(card.getByTitle('Preview of m1')).toHaveAttribute('data-url', '/files/m1');
    await expect(card.getByRole('link', { name: 'Download rubric.pdf' })).toHaveAttribute('href', '/files/m1?download=1');
    await expect(card.getByRole('list', { name: 'Your files' })).toContainText('lab.pdf');
    await expect(card.getByRole('button', { name: 'Remove lab.pdf' })).toBeVisible();
    await expect(card).toContainText('Up to 10 MB a file.');
    await expect(card).toContainText('Steps · 1 of 2');
    // Unticked steps ask before handing in.
    await card.getByRole('button', { name: 'Hand in', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('1 step isn’t ticked');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    await card.getByRole('button', { name: 'Message your teacher or TA' }).click();
    await card.getByRole('button', { name: 'Class questions' }).click();
    await expect(page.locator('#opened')).toHaveText('private,class');
    expect(await axeViolations(page)).toEqual([]);
});

test('2.5, 2.10: with no file the button is off and says why; a file over the limit is refused before uploading', async ({ page }) => {
    const card = await open(page, 'empty');
    await expect(card.getByRole('button', { name: 'Hand in', exact: true })).toBeDisabled();
    await expect(card).toContainText('Add a file to hand it in.');
    await card.locator('input[type=file]').setInputFiles({ name: 'huge.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(11 * 1024 * 1024) });
    await expect(card.getByRole('alert')).toContainText('huge.mp4 is 11 MB. Files can be up to 10 MB.');
});

test('2.2, 2.6, 2.9: waiting work lists the handed-in files once, has no Replace, and keeps its history', async ({ page }) => {
    const card = await open(page, 'waiting');
    await expect(card.getByRole('status')).toContainText('Version 2 · Waiting for review');
    await expect(card.getByRole('list', { name: 'Version 2 files' })).toContainText('lab-v2.pdf');
    await expect(card.getByRole('list', { name: 'Your files' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /Hand in|Replace/ })).toHaveCount(0);
    await expect(card.getByRole('status').getByRole('button', { name: 'Message your teacher or TA' })).toBeVisible();
    await card.getByText('History · 3').click();
    const history = card.getByRole('list', { name: 'History' });
    await expect(history).toContainText('Returned');
    await expect(history).toContainText('“Add the test cases.”');
    await expect(history.getByRole('listitem').first()).toContainText('Version 2 handed in');
});

test('2.4, 2.14: returned link work shows who returned it and why, and the link must be a web link', async ({ page }) => {
    const card = await open(page, 'returned');
    await expect(card.getByRole('status')).toContainText('Ms. Rao returned this');
    await expect(card.getByRole('status')).toContainText('Add the test cases.');
    await expect(card.getByRole('status')).toContainText('Fix by');
    const input = card.getByRole('textbox', { name: 'Link to your work' });
    await input.fill('docs.google.com/x');
    await expect(card).toContainText('That isn’t a web link. Start it with https://');
    await expect(card.getByRole('button', { name: 'Hand in again' })).toBeDisabled();
    await input.fill('https://docs.google.com/x');
    await expect(card.getByRole('button', { name: 'Hand in again' })).toBeEnabled();
});

test('2.14: text answers count their characters', async ({ page }) => {
    const card = await open(page, 'text');
    await card.getByRole('textbox', { name: 'Your answer' }).fill('Hello');
    await expect(card).toContainText('5 / 10,000');
});

test('2.13: excused and closed work get a box with the next step and Message, and no form', async ({ page }) => {
    let card = await open(page, 'excused');
    await expect(card.getByRole('status')).toContainText('You’re excused');
    await expect(card.getByRole('status')).toContainText('Medical leave');
    await expect(card.getByRole('status').getByRole('button', { name: 'Message your teacher or TA' })).toBeVisible();
    await expect(card.getByRole('button', { name: /Hand in/ })).toHaveCount(0);
    card = await open(page, 'closed');
    await expect(card.getByRole('status')).toContainText('This assignment is closed');
    await expect(card.getByRole('status')).toContainText('Message them if you need more time.');
});

test('5.4: the card fits a phone', async ({ page }) => {
    const card = await open(page, 'open', 375);
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath('hand-in-375.png'), fullPage: true });
});

test('3.12, 3.13: an admin opening a waiting copy gets the same decision, Next waiting and Back to queue', async ({ page }) => {
    const card = await open(page, 'admin');
    const review = card.getByRole('region', { name: 'Review this hand-in' });
    await expect(review.getByRole('button', { name: 'Approve' })).toBeVisible();
    await review.getByRole('button', { name: 'Return' }).click();
    await expect(review.getByLabel('Fix by')).not.toHaveValue('');
    await expect(review.getByRole('group', { name: 'Recent reasons' })).toContainText('Add the test cases.');
    await expect(review.getByRole('link', { name: 'Next waiting: Kiran' })).toHaveAttribute('href', /drawerId=c9/);
    await expect(review.getByRole('link', { name: 'Back to queue' })).toHaveAttribute('href', /taskScope=review&assignment=a1/);
    await expect(card.getByRole('button', { name: /Hand in/ })).toHaveCount(0);
    await expect(card.getByRole('link', { name: 'Back to the assignment' })).toHaveAttribute('href', /drawerId=a1/);
});

test('3.14: approved work says who approved it and when', async ({ page }) => {
    const card = await open(page, 'approved');
    await expect(card.getByRole('status')).toContainText(/Approved by Ms\. Rao · /);
    await expect(card.getByRole('link', { name: /Back to the assignment/ })).toHaveCount(0);
});
