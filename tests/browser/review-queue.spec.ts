import { exportedNames, serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';

// Mockup task 2 (Review artboard): waiting list, the work itself, then note, steps, conversation and the decision.
const origin = 'https://review-queue.test';
let script: string, css: string;
const ok = 'async()=>({success:true})';
const row = (i: number, extra = '') => `{kind:'copy',mine:true,copyId:'c${i}',masterId:${i % 2 ? "'a1'" : "'a2'"},title:${i % 2 ? "'Lab 3: Heap operations'" : "'Lab 2'"},who:'Student ${i}',submittedBy:null,
  submittedAt:new Date(Date.now()-(100-${i})*36e5).toISOString(),late:${i === 1},href:'?tab=tasks&drawerId=c${i}',projectId:'org',updatedAt:new Date().toISOString(),version:2,link:null,text:null,
  note:'I used the second dataset.',files:[{nodeId:'n${i}',name:${i === 1 ? "'lab3-report.pdf'" : "'lab3.zip'"},size:2100000}${i === 1 ? ",{nodeId:'n1b',name:'data.xlsx',size:4000}" : ''}],
  versions:[{version:1,at:new Date(Date.now()-864e5).toISOString(),files:[{nodeId:'v${i}',name:${i === 1 ? "'lab3-report.pdf'" : "'lab3-v1.pdf'"},size:1000}]}],
  steps:[{title:'Read the brief',done:true},{title:'Write the tests',done:false}],comments:2,left:false,dueDate:null${extra}}`;

async function bundle(rows: string) {
    const mocks: Record<string, string> = {
        '@/hooks/use-auth': `export const useAuth=()=>({user:{id:'u1'}});`,
        'next/dynamic': `import React from 'react';export default (load)=>{const C=React.lazy(()=>load().then((m)=>({default:m.default??m})));return (p)=>React.createElement(React.Suspense,{fallback:null},React.createElement(C,p));};`,
        '@/components/workspaces/v2/preview/UniversalPreviewEngine': `import React from 'react';export default ({node,fileUrl})=>React.createElement('div',{title:'Preview of '+node.name,'data-url':fileUrl},node.name);`,
        '@/app/actions/files/nodes': `export const getNodesByIds=async(p,ids)=>ids.filter((id)=>id!=='n3').map((id)=>({id,name:{n1:'lab3-report.pdf',n1b:'data.xlsx',v1:'lab3-report.pdf'}[id]??'lab3.zip',type:'file',mimeType:null}));`,
        '@/app/actions/assignments': `export const readReviewQueueAction=async()=>({success:true,total:${rows.split('kind:').length - 1},rows:[${rows}],recentReasons:['Add the test cases.','Cite your sources.']});
            export const reviewAssignmentCopyAction=async(...a)=>{(window.sent??=[]).push(a);return {success:true}};`,
        '@/app/actions/files/content': `export const getFilePreviewUrl=async(p,n,d)=>({url:'/files/'+n+(d?'?download=1':'')});`,
        '@/app/actions/moderation': `export const moderatedItemsAction=async()=>[];`,
        '@/app/actions/task-comment': `export const createTaskCommentAction=${ok};export const readTaskDiscussionAction=async(_p,taskId)=>taskId!=='c1'?{success:true,data:{comments:[{id:'o-'+taskId,taskId,userId:'u3',parentCommentId:null,content:'Thread of '+taskId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),deletedAt:null,deletedBy:null,author:{id:'u3',fullName:'Ravi',username:'ravi',avatarUrl:null},likeCount:0,likedByViewer:false,replies:[]}],nextCursor:null,totalCount:1}}:({success:true,data:{comments:[
            {id:'m2',taskId:'c1',userId:'u1',parentCommentId:null,content:'Yes, note it in the report.',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),deletedAt:null,deletedBy:null,author:{id:'u1',fullName:'Ms. Rao',username:'rao',avatarUrl:null},likeCount:0,likedByViewer:false,replies:[]},
            {id:'m1',taskId:'c1',userId:'u2',parentCommentId:null,content:'Can I use my own dataset?',createdAt:new Date(Date.now()-36e5).toISOString(),updatedAt:new Date(Date.now()-36e5).toISOString(),deletedAt:null,deletedBy:null,author:{id:'u2',fullName:'Asha Rao',username:'asha',avatarUrl:null},likeCount:0,likedByViewer:false,replies:[]}],nextCursor:null,totalCount:2}});`,
    };
    // Every other export of a mocked actions file answers like a refused request, as the plugin does for unmocked ones.
    for (const [spec, file] of [['@/app/actions/assignments', 'src/app/actions/assignments.ts'], ['@/app/actions/files/content', 'src/app/actions/files/content.ts'], ['@/app/actions/task-comment', 'src/app/actions/task-comment.ts'], ['@/app/actions/files/nodes', 'src/app/actions/files/nodes.ts']] as const) {
        const own = new Set(exportedNames(mocks[spec]!));
        const rest = exportedNames(await readFile(file, 'utf8')).filter((n) => !own.has(n));
        mocks[spec] += rest.map((n) => `export const ${n}=async()=>({success:false,error:'Not in this fixture'});`).join('');
    }
    const out = await build({ entryPoints: [path.resolve('tests/browser/review-queue.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'review-queue', setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }, serverActionsPlugin] });
    return out.outputFiles![0]!.text;
}

test.beforeAll(async () => {
    script = await bundle([1, 2, 3].map((i) => row(i)).join(','));
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, width: number, query = '', js = script) {
    await page.setViewportSize({ width, height: 900 });
    await page.route(origin + '/**', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/files/')) return route.fulfill({ body: '%PDF-1.4', contentType: 'application/pdf' });
        const body = url.pathname === '/app.js' ? js : url.pathname === '/app.css' ? css : '<html lang="en"><head><title>Review</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/${query}`);
}

test('the queue sits beside the work: waiting list, the file, then note, steps, conversation and the decision', async ({ page }) => {
    await open(page, 1440);
    const waiting = page.getByRole('region', { name: 'Waiting' });
    const work = page.getByRole('region', { name: 'Submission' });
    const details = page.getByRole('region', { name: 'Details' });
    await expect(waiting.getByRole('button', { name: /Student 1/ })).toHaveAttribute('aria-current', 'true');
    await expect(work.getByTitle('Preview of lab3-report.pdf')).toHaveAttribute('data-url', '/files/n1');
    await expect(work.getByRole('link', { name: 'Download lab3-report.pdf' })).toHaveAttribute('href', '/files/n1?download=1');
    await expect(work.getByRole('combobox', { name: 'Versions' })).toContainText('Version 1 · lab3-report.pdf');
    await expect(details).toContainText('I used the second dataset.');
    await expect(details.getByRole('list', { name: 'Steps' })).toContainText('Write the tests');
    await expect(details).toContainText('Steps · 1 of 2 ticked');
    // Board/review report §3: the whole private conversation, in place.
    const conversation = details.getByRole('region', { name: 'Private conversation' });
    await expect(conversation).toContainText('Can I use my own dataset?');
    await expect(conversation).toContainText('Yes, note it in the report.');
    await expect(conversation.getByRole('combobox', { name: 'Add a comment' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the whole conversation' })).toHaveCount(0);
    // Moving to the next person switches the conversation to theirs.
    await page.getByRole('button', { name: /Next/ }).first().click();
    await expect(conversation).not.toContainText('Can I use my own dataset?');
    await expect(conversation).toContainText(/Thread of c\d/);
    await waiting.getByRole('button', { name: /Student 2/ }).click();
    await expect(work.getByTitle('Preview of lab3.zip')).toBeVisible();
    await expect(work.getByRole('link', { name: 'Download lab3.zip' })).toBeVisible();
    await details.getByRole('button', { name: 'Return' }).click();
    await expect(details.getByRole('textbox', { name: 'What should Student 2 change?' })).toBeVisible();
});

test('a file the reviewer cannot open here says so and links to the hand-in, instead of loading forever', async ({ page }) => {
    await open(page, 1440);
    await page.getByRole('region', { name: 'Waiting' }).getByRole('button', { name: /Student 3/ }).click();
    const work = page.getByRole('region', { name: 'Submission' });
    await expect(work).toContainText("The preview isn’t available here.");
    await expect(work.getByRole('link', { name: 'Open the hand-in' })).toHaveAttribute('href', '?tab=tasks&drawerId=c3');
    await expect(work).not.toContainText('Loading lab3.zip');
});

test('Review N from the panel opens the queue on that assignment', async ({ page }) => {
    await open(page, 1440, '?assignment=a2');
    const waiting = page.getByRole('region', { name: 'Waiting' });
    await expect(waiting.getByRole('listitem')).toHaveCount(1);
    await expect(waiting).toContainText('Student 2');
});

test('on a phone the three parts stack; a long queue scrolls inside its own list', async ({ page }) => {
    const many = await bundle(Array.from({ length: 60 }, (_, i) => row(i + 1)).join(','));
    await open(page, 390, '', many);
    const waiting = page.getByRole('region', { name: 'Waiting' });
    const work = page.getByRole('region', { name: 'Submission' });
    const [a, b] = [await waiting.boundingBox(), await work.boundingBox()];
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
    expect(await waiting.getByRole('list').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('3.1, 3.2, 3.3, 4.1, 4.3: every file has a tab, each version opens its own files, Compare puts the earlier one beside it, and the file bar has its links', async ({ page }) => {
    await open(page, 1440);
    const work = page.getByRole('region', { name: 'Submission' });
    await expect(work.getByRole('tablist', { name: 'Files' }).getByRole('tab')).toHaveText(['lab3-report.pdf', 'data.xlsx']);
    await work.getByRole('tab', { name: 'data.xlsx' }).click();
    await expect(work.getByTitle('Preview of data.xlsx')).toHaveAttribute('data-url', '/files/n1b');
    await expect(work.getByRole('link', { name: 'Open data.xlsx in a new tab' })).toHaveAttribute('target', '_blank');
    await expect(work.getByRole('button', { name: 'Show data.xlsx full screen' })).toBeVisible();
    await work.getByRole('tab', { name: 'lab3-report.pdf' }).click();
    await work.getByRole('button', { name: 'Compare' }).click();
    await expect(work.getByTestId('file-viewer')).toHaveCount(2);
    await expect(work).toContainText('Version 1');
    await work.getByRole('button', { name: 'Compare' }).click();
    await work.getByRole('combobox', { name: 'Versions' }).selectOption('1');
    await expect(work.getByTitle('Preview of lab3-report.pdf')).toHaveAttribute('data-url', '/files/v1');
    // The decision sits at the bottom of the right column.
    const details = page.getByRole('region', { name: 'Details' });
    const [d, decision] = [await details.boundingBox(), await details.getByRole('group', { name: 'Decision' }).boundingBox()];
    expect(decision!.y).toBeGreaterThan(d!.y + d!.height / 2);
});

test('3.6, 3.7, 3.9: reply in place; Return offers recent reasons; a decision waits with Undo before it is sent', async ({ page }) => {
    await open(page, 1440);
    const details = page.getByRole('region', { name: 'Details' });
    await expect(details.getByRole('combobox', { name: 'Add a comment' })).toBeVisible();
    await details.getByRole('button', { name: 'Return' }).click();
    await details.getByRole('group', { name: 'Recent reasons' }).getByRole('button', { name: 'Cite your sources.' }).click();
    await expect(details.getByRole('textbox', { name: 'What should Student 1 change?' })).toHaveValue('Cite your sources.');
    await details.getByRole('button', { name: 'Cancel' }).click();
    await details.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('region', { name: 'Waiting' }).getByRole('button', { name: /Student 1/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('region', { name: 'Waiting' }).getByRole('button', { name: /Student 1/ })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { sent?: unknown[] }).sent?.length ?? 0)).toBe(0);
});

test('3.8, 3.10: the queue names itself for screen readers, searches names and sorts newest first', async ({ page }) => {
    await open(page, 1440);
    await expect(page.getByRole('heading', { name: 'To review' })).toBeAttached();
    const waiting = page.getByRole('region', { name: 'Waiting' });
    await expect(waiting.getByRole('listitem').first()).toContainText('Student 1');
    await page.getByRole('combobox', { name: 'Sort' }).selectOption('newest');
    await expect(waiting.getByRole('listitem').first()).toContainText('Student 3');
    await page.getByRole('textbox', { name: 'Search names' }).fill('student 2');
    await expect(waiting.getByRole('listitem')).toHaveCount(1);
});

test('board/review report §2: one line above the work — the filters, then the board tabs with the waiting count; the columns start right under it', async ({ page }) => {
    await open(page, 1440, '?tabs=1');
    const search = await page.getByRole('textbox', { name: 'Search names' }).boundingBox();
    const tabs = await page.getByRole('group', { name: 'Show' }).boundingBox();
    expect(Math.abs(search!.y + search!.height / 2 - (tabs!.y + tabs!.height / 2))).toBeLessThan(12);
    await expect(page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /In review\s*3/ })).toBeVisible();
    const waiting = await page.getByRole('region', { name: 'Waiting' }).boundingBox();
    expect(waiting!.y - (search!.y + search!.height)).toBeLessThan(40);
    await expect(page.getByRole('region', { name: 'Waiting' })).toContainText('1 of 3');
    await expect(page.getByRole('button', { name: 'Back to board' })).toHaveCount(0);
    // Esc goes back to the board — but not while typing in a field.
    await page.getByRole('textbox', { name: 'Search names' }).press('Escape');
    await expect(page).not.toHaveTitle('closed');
    await page.locator('body').click({ position: { x: 5, y: 890 } });
    await page.keyboard.press('Escape');
    await expect(page).toHaveTitle('closed');
});
