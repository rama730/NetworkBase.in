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
  submittedAt:new Date(Date.now()-${i}*36e5).toISOString(),late:${i === 1},href:'?tab=tasks&drawerId=c${i}',projectId:'org',updatedAt:new Date().toISOString(),version:2,link:null,text:null,
  note:'I used the second dataset.',files:[{nodeId:'n${i}',name:${i === 1 ? "'lab3-report.pdf'" : "'lab3.zip'"},size:2100000}],versions:[{version:1,at:new Date(Date.now()-864e5).toISOString(),files:['lab3-v1.pdf']}],
  steps:{done:4,total:5},comments:2,left:false${extra}}`;

async function bundle(rows: string) {
    const mocks: Record<string, string> = {
        '@/hooks/use-auth': `export const useAuth=()=>({user:{id:'u1'}});`,
        'next/dynamic': `import React from 'react';export default (load)=>{const C=React.lazy(()=>load().then((m)=>({default:m.default??m})));return (p)=>React.createElement(React.Suspense,{fallback:null},React.createElement(C,p));};`,
        '@/components/workspaces/v2/preview/UniversalPreviewEngine': `import React from 'react';export default ({node,fileUrl})=>React.createElement('div',{title:'Preview of '+node.name,'data-url':fileUrl},node.name);`,
        '@/app/actions/files/nodes': `export const getNodesByIds=async(p,ids)=>ids.map((id)=>({id,name:id==='n1'?'lab3-report.pdf':'lab3.zip',type:'file',mimeType:null}));`,
        '@/app/actions/assignments': `export const readReviewQueueAction=async()=>({success:true,total:${rows.split('kind:').length - 1},rows:[${rows}]});export const reviewAssignmentCopyAction=${ok};`,
        '@/app/actions/files/content': `export const getFilePreviewUrl=async(p,n,d)=>({url:'/files/'+n+(d?'?download=1':'')});`,
        '@/app/actions/task-comment': `export const createTaskCommentAction=${ok};export const readTaskDiscussionAction=async()=>({success:true,data:{comments:[
            {id:'m2',content:'Yes, note it in the report.',createdAt:new Date().toISOString(),author:{fullName:'Ms. Rao',username:'rao'}},
            {id:'m1',content:'Can I use my own dataset?',createdAt:new Date(Date.now()-36e5).toISOString(),author:{fullName:'Asha Rao',username:'asha'}}],nextCursor:null,totalCount:2}});`,
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
    await expect(work.getByRole('combobox', { name: 'Versions' })).toContainText('Version 1 · lab3-v1.pdf');
    await expect(details).toContainText('I used the second dataset.');
    await expect(details).toContainText('Steps 4 of 5 ticked');
    await expect(details.getByRole('list', { name: 'Private conversation' })).toContainText('Asha Rao: Can I use my own dataset?');
    await waiting.getByRole('button', { name: /Student 2/ }).click();
    await expect(work.getByTitle('Preview of lab3.zip')).toBeVisible();
    await expect(work.getByRole('link', { name: 'Download lab3.zip' })).toBeVisible();
    await details.getByRole('button', { name: 'Return' }).click();
    await expect(details.getByRole('textbox', { name: 'What should Student 2 change?' })).toBeVisible();
});

test('Review N from the panel opens the queue on that assignment', async ({ page }) => {
    await open(page, 1440, '?assignment=a2');
    const waiting = page.getByRole('region', { name: 'Waiting' });
    await expect(waiting.getByRole('button')).toHaveCount(1);
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
