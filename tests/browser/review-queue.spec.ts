import { exportedNames, serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from './axe';

// Mockup task 2 (Review artboard): waiting list, the work itself, then note, steps, conversation and the decision.
const origin = 'https://review-queue.test';
let script: string, css: string;
const ok = 'async()=>({success:true})';
const row = (i: number, extra = '') => `{kind:'copy',mine:true,copyId:'c${i}',masterId:${i % 2 ? "'a1'" : "'a2'"},title:${i % 2 ? "'Lab 3: Heap operations'" : "'Lab 2'"},who:'Student ${i}',submittedBy:null,
  submittedAt:new Date(Date.now()-(100-${i})*36e5).toISOString(),late:${i === 1},href:'?tab=tasks&drawerId=c${i}',projectId:'org',updatedAt:new Date().toISOString(),version:2,link:null,text:null,
  note:'I used the second dataset.',files:[{nodeId:'n${i}',name:${i === 1 ? "'lab3-report.pdf'" : "'lab3.zip'"},size:2100000}${i === 1 ? ",{nodeId:'n1b',name:'data.xlsx',size:4000}" : ''}],
  versions:[{version:1,at:new Date(Date.now()-864e5).toISOString(),files:[{nodeId:'v${i}',name:${i === 1 ? "'lab3-report.pdf'" : "'lab3-v1.pdf'"},size:1000}]}],
  steps:[{title:'Read the brief',done:true},{title:'Write the tests',done:false}],comments:2,left:false,
  dueDate:${i === 1 ? 'new Date(Date.now()-(100-1)*36e5-2*36e5).toISOString()' : 'null'},
  people:${i === 3 ? "[{id:'p3',name:'Asha',avatarUrl:null},{id:'p4',name:'Kiran',avatarUrl:null},{id:'p5',name:'Ravi',avatarUrl:null}]" : `[{id:'p${i}',name:'Student ${i}',avatarUrl:null}]`},
  newMessages:${i === 2 ? 1 : 0},lastAsk:${i === 1 ? "'Cite your sources.'" : 'null'},
  events:${i === 1 ? "[{id:'e1',at:new Date(Date.now()-6*864e5).toISOString(),text:'Version 1 handed in by Student 1'},{id:'e2',at:new Date(Date.now()-5*864e5).toISOString(),text:'Returned by Ms. Rao: Cite your sources. · fix by Nov 13'},{id:'e3',at:new Date(Date.now()-99*36e5).toISOString(),text:'Version 2 handed in by Student 1'}]" : '[]'}${extra}}`;

async function bundle(rows: string) {
    const mocks: Record<string, string> = {
        '@/hooks/use-auth': `export const useAuth=()=>({user:{id:'u1'}});`,
        'next/dynamic': `import React from 'react';export default (load)=>{const C=React.lazy(()=>load().then((m)=>({default:m.default??m})));return (p)=>React.createElement(React.Suspense,{fallback:null},React.createElement(C,p));};`,
        '@/components/workspaces/v2/preview/UniversalPreviewEngine': `import React from 'react';export default ({node,fileUrl})=>React.createElement('div',{title:'Preview of '+node.name,'data-url':fileUrl},node.name);`,
        '@/app/actions/files/nodes': `export const getNodesByIds=async(p,ids)=>ids.filter((id)=>id!=='n3').map((id)=>({id,name:{n1:'lab3-report.pdf',n1b:'data.xlsx',v1:'lab3-report.pdf'}[id]??'lab3.zip',type:'file',mimeType:null}));`,
        // Review queue §4b: pages (?paged), live reloads (window.extra rows), presence (?viewers) and a note that fails (window.noteFails).
        '@/app/actions/assignments': `const base=()=>[${rows}];export const readReviewQueueAction=async(_o,cursor)=>{const paged=new URLSearchParams(location.search).has('paged');
            if(cursor==='p2')return {success:true,total:4,rows:[${row(4)}],recentReasons:[],nextCursor:null};
            const all=[...base(),...(window.extra??[])];return {success:true,total:all.length+(paged?1:0),rows:all,recentReasons:['Add the test cases.','Cite your sources.'],nextCursor:paged?'p2':null}};
            export const reviewAssignmentCopyAction=async(...a)=>{(window.sent??=[]).push(a);return {success:true}};`,
        '@/app/actions/files/content': `export const getFilePreviewUrl=async(p,n,d)=>({url:'/files/'+n+(d?'?download=1':'')});`,
        '@/app/actions/moderation': `export const moderatedItemsAction=async()=>[];`,
        '@/hooks/useRoomViewers': `export const useRoomViewers=()=>new URLSearchParams(location.search).has('viewers')?['Priya']:[];`,
        '@/lib/realtime/private-broadcast': `export const subscribeBroadcast=(_t,cb)=>{(window.listeners??=new Set()).add(cb);window.notify=(e)=>window.listeners.forEach((f)=>f(e));return {unsubscribe(){window.listeners.delete(cb)}}};`,
        '@/app/actions/workspace': `export const markTaskAsReadAction=async(id)=>{(window.read??=[]).push(id);return {success:true}};`,
        '@/app/actions/task-comment': `export const createTaskCommentAction=async(...a)=>{if(window.noteFails)return {success:false,error:'down'};(window.notes??=[]).push(a);return {success:true}};export const readTaskDiscussionAction=async(_p,taskId)=>taskId!=='c1'?{success:true,data:{comments:[{id:'o-'+taskId,taskId,userId:'u3',parentCommentId:null,content:'Thread of '+taskId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),deletedAt:null,deletedBy:null,author:{id:'u3',fullName:'Ravi',username:'ravi',avatarUrl:null},likeCount:0,likedByViewer:false,replies:[]}],nextCursor:null,totalCount:1}}:({success:true,data:{comments:[
            {id:'m2',taskId:'c1',userId:'u1',parentCommentId:null,content:'Yes, note it in the report.',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),deletedAt:null,deletedBy:null,author:{id:'u1',fullName:'Ms. Rao',username:'rao',avatarUrl:null},likeCount:0,likedByViewer:false,replies:[]},
            {id:'m1',taskId:'c1',userId:'u2',parentCommentId:null,content:'Can I use my own dataset?',createdAt:new Date(Date.now()-36e5).toISOString(),updatedAt:new Date(Date.now()-36e5).toISOString(),deletedAt:null,deletedBy:null,author:{id:'u2',fullName:'Asha Rao',username:'asha',avatarUrl:null},likeCount:0,likedByViewer:false,replies:[]}],nextCursor:null,totalCount:2}});`,
    };
    // Every other export of a mocked actions file answers like a refused request, as the plugin does for unmocked ones.
    for (const [spec, file] of [['@/app/actions/assignments', 'src/app/actions/assignments.ts'], ['@/app/actions/files/content', 'src/app/actions/files/content.ts'], ['@/app/actions/task-comment', 'src/app/actions/task-comment.ts'], ['@/app/actions/files/nodes', 'src/app/actions/files/nodes.ts'], ['@/app/actions/workspace', 'src/app/actions/workspace/index.ts'], ['@/lib/realtime/private-broadcast', 'src/lib/realtime/private-broadcast.ts']] as const) {
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

test('review queue §1–§3: who is waiting on the left, the work with the decision on its header in the middle, only the discussion on the right', async ({ page }) => {
    await open(page, 1440);
    const waiting = page.getByRole('region', { name: 'Waiting' });
    const work = page.getByRole('region', { name: 'Submission' });
    const discussion = page.getByRole('region', { name: 'Discussion' });
    await expect(waiting.getByRole('button', { name: /Student 1/ })).toHaveAttribute('aria-current', 'true');
    // A resubmission opens with Compare on: version 1 beside version 2.
    await expect(work.getByTitle('Preview of lab3-report.pdf').last()).toHaveAttribute('data-url', '/files/n1');
    await expect(work.getByRole('link', { name: 'Download lab3-report.pdf' }).last()).toHaveAttribute('href', '/files/n1?download=1');
    await expect(work.getByRole('combobox', { name: 'Versions' })).toContainText('Version 1 · lab3-report.pdf');
    // The decision is on the work's header, above the file; their note, what was asked last time and the steps under it.
    const decision = work.getByRole('group', { name: 'Decision' });
    const name = work.getByRole('heading', { name: 'Student 1' });
    expect(Math.abs((await decision.boundingBox())!.y - (await name.boundingBox())!.y)).toBeLessThan(16);
    expect((await decision.boundingBox())!.y).toBeLessThan((await work.getByTestId('file-viewer').first().boundingBox())!.y);
    await expect(work).toContainText('Their note: “I used the second dataset.”');
    await expect(work).toContainText('Asked last time: Cite your sources.');
    await work.getByRole('button', { name: /Steps 1 of 2/ }).click();
    await expect(work.getByRole('list', { name: 'Steps' })).toContainText('Write the tests');
    await expect(work).toContainText(/due \w{3} \d+ · 2 hours late/);
    // One heading; the thread; the box at the bottom with Send fully visible.
    await expect(discussion.getByRole('heading', { name: 'Discussion' })).toHaveCount(1);
    await expect(page.getByText('Private conversation')).toHaveCount(0);
    await expect(discussion).toContainText('Can I use my own dataset?');
    await expect(discussion).toContainText('Yes, note it in the report.');
    await expect(discussion.getByRole('note')).toHaveText([/Version 1 handed in by Student 1/, /Returned by Ms. Rao: Cite your sources\. · fix by Nov 13/, /Version 2 handed in by Student 1/]);
    const box = discussion.getByRole('combobox', { name: 'Add a comment' });
    await expect(box).toBeVisible();
    expect((await box.boundingBox())!.y).toBeGreaterThan((await discussion.getByText('Yes, note it in the report.').boundingBox())!.y);
    const send = discussion.getByRole('button', { name: 'Post comment' });
    const [sb, db] = [(await send.boundingBox())!, (await discussion.boundingBox())!];
    expect(sb.x + sb.width).toBeLessThanOrEqual(db.x + db.width + 0.5);
    await expect(page.getByPlaceholder('Add note (optional)')).toHaveCount(0);
    // Moving to the next person switches the conversation to theirs.
    await waiting.getByRole('button', { name: 'Next' }).click();
    await expect(discussion).not.toContainText('Can I use my own dataset?');
    await expect(discussion).toContainText(/Thread of c\d/);
    await waiting.getByRole('button', { name: /Student 2/ }).click();
    await expect(work.getByTitle('Preview of lab3.zip').last()).toBeVisible();
    await work.getByRole('button', { name: 'Return', exact: true }).click();
    await expect(work.getByRole('dialog', { name: 'Return to Student 2' }).getByRole('textbox', { name: 'What should Student 2 change?' })).toBeVisible();
});

test('review queue §4a: the three column tops line up, nothing wraps, and the filters are one height', async ({ page }) => {
    for (const width of [1440, 1280]) {
        await open(page, width);
        const tops = await Promise.all(['Waiting', 'Submission'].map(async (n) => (await page.getByRole('region', { name: n }).boundingBox())!.y));
        const right = (await page.getByRole('region', { name: 'Discussion' }).locator('..').locator('..').boundingBox())!.y;
        expect(Math.max(...tops, right) - Math.min(...tops, right)).toBeLessThan(2);
        const heights = await Promise.all([page.getByRole('textbox', { name: 'Search names' }), page.getByRole('combobox', { name: 'Assignment' }), page.getByRole('combobox', { name: 'Sort' }), page.getByRole('button', { name: 'Late only' })]
            .map(async (l) => Math.round((await l.boundingBox())!.height)));
        expect(new Set(heights).size).toBe(1);
        const name = page.getByRole('region', { name: 'Submission' }).getByRole('heading', { name: 'Student 1' });
        expect((await name.boundingBox())!.height).toBeLessThan(26);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    }
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

test('review queue §4: on a phone the parts stack — a picker, the work with its decision held at the top, then the discussion', async ({ page }) => {
    const many = await bundle(Array.from({ length: 60 }, (_, i) => row(i + 1)).join(','));
    await open(page, 390, '', many);
    const picker = page.getByRole('combobox', { name: 'Waiting' });
    await expect(picker).toBeVisible();
    await expect(page.getByRole('region', { name: 'Waiting' })).toBeHidden();
    const work = page.getByRole('region', { name: 'Submission' });
    const discussion = page.getByRole('region', { name: 'Discussion' });
    expect((await discussion.boundingBox())!.y).toBeGreaterThan((await work.boundingBox())!.y);
    await picker.selectOption({ label: 'Student 5 · 5 of 60' });
    await expect(work.getByRole('heading', { name: 'Student 5' })).toBeVisible();
    expect(await work.getByRole('group', { name: 'Decision' }).locator('..').evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
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
    // A resubmission starts with Compare on; it turns off and on.
    await expect(work.getByRole('button', { name: 'Compare' })).toHaveAttribute('aria-pressed', 'true');
    await expect(work.getByTestId('file-viewer')).toHaveCount(2);
    await expect(work).toContainText('Version 1');
    await work.getByRole('button', { name: 'Compare' }).click();
    await expect(work.getByTestId('file-viewer')).toHaveCount(1);
    await work.getByRole('combobox', { name: 'Versions' }).selectOption('1');
    await expect(work.getByTitle('Preview of lab3-report.pdf')).toHaveAttribute('data-url', '/files/v1');
    // One file bar: Download, New tab and Full screen once.
    await expect(work.getByTestId('file-bar')).toHaveCount(1);
    await expect(work.getByRole('link', { name: /^Download / })).toHaveCount(1);
});

test('3.6, 3.7, 3.9: reply in place; Return offers recent reasons; a decision waits with Undo before it is sent', async ({ page }) => {
    await open(page, 1440);
    const details = page.getByRole('region', { name: 'Submission' });
    await expect(page.getByRole('region', { name: 'Discussion' }).getByRole('combobox', { name: 'Add a comment' })).toBeVisible();
    await details.getByRole('button', { name: 'Return', exact: true }).click();
    await details.getByRole('group', { name: 'Recent reasons' }).getByRole('button', { name: 'Cite your sources.' }).click();
    await expect(details.getByRole('textbox', { name: 'What should Student 1 change?' })).toHaveValue('Cite your sources.');
    await details.getByRole('button', { name: 'Cancel' }).click();
    await details.getByRole('button', { name: 'Approve', exact: true }).click();
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
    // Board view dropdown §2: the board's views are one View button at the end of the queue's line.
    const view = page.getByRole('button', { name: /^Show: In review/ });
    const tabs = await view.boundingBox();
    expect(Math.abs(search!.y + search!.height / 2 - (tabs!.y + tabs!.height / 2))).toBeLessThan(12);
    await expect(view).toHaveAccessibleName('Show: In review. 1 in other views need you');
    await view.click();
    await expect(page.getByRole('menuitemradio', { name: /^In review ?, 3 open, 3 waiting for you$/ })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
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

test('review queue §2 (D1): Approve with a note posts the note, then approves', async ({ page }) => {
    await open(page, 1440);
    const work = page.getByRole('region', { name: 'Submission' });
    await work.getByRole('button', { name: 'More ways to approve' }).click();
    await page.getByRole('menuitem', { name: 'Approve with a note…' }).click();
    const box = work.getByRole('dialog', { name: 'Approve with a note' });
    await box.getByRole('textbox', { name: 'A note for Student 1' }).fill('Nice tests.');
    await box.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('region', { name: 'Waiting' }).getByRole('button', { name: /Student 1/ })).toHaveCount(0);
    await page.waitForTimeout(10_500);
    expect(await page.evaluate(() => (window as unknown as { notes?: unknown[][] }).notes?.[0]?.[2])).toBe('Nice tests.');
    expect(await page.evaluate(() => (window as unknown as { sent?: unknown[][] }).sent?.[0]?.[1])).toBe('approve');
});

test('review queue §4b.9: a note that can not be sent is not approved; it comes back to the discussion box', async ({ page }) => {
    await open(page, 1440);
    await page.evaluate(() => { (window as unknown as { noteFails: boolean }).noteFails = true; });
    const work = page.getByRole('region', { name: 'Submission' });
    await work.getByRole('button', { name: 'More ways to approve' }).click();
    await page.getByRole('menuitem', { name: 'Approve with a note…' }).click();
    await work.getByRole('textbox', { name: 'A note for Student 1' }).fill('Nice tests.');
    await work.getByRole('dialog', { name: 'Approve with a note' }).getByRole('button', { name: 'Approve' }).click();
    await page.waitForTimeout(10_500);
    await expect(page.getByRole('alert')).toContainText('Your note didn’t send, so it isn’t approved yet');
    await expect(work.getByRole('heading', { name: 'Student 1' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Discussion' }).getByRole('combobox', { name: 'Add a comment' })).toHaveText('Nice tests.');
    expect(await page.evaluate(() => (window as unknown as { sent?: unknown[] }).sent?.length ?? 0)).toBe(0);
});

test('review queue §4b.1, §4b.3: a hand-in arriving mid-review never changes who is shown; the link keeps your place', async ({ page }) => {
    await open(page, 1440);
    const waiting = page.getByRole('region', { name: 'Waiting' });
    await waiting.getByRole('button', { name: /Student 2/ }).click();
    await expect(page).toHaveURL(/review=c2/);
    await expect(page).toHaveTitle('Review · Student 2 · Lab 2');
    // An older hand-in arrives (it would sort first by time) — the person shown stays Student 2.
    await page.evaluate(() => { const w = window as unknown as { extra: unknown[]; notify: (e: string) => void }; w.extra = [{ ...{}, kind: 'copy', mine: true, copyId: 'c9', masterId: 'a1', title: 'Lab 3: Heap operations', who: 'Student 9', submittedBy: null,
        submittedAt: new Date(Date.now() - 500 * 36e5).toISOString(), late: false, href: '?tab=tasks&drawerId=c9', projectId: 'org', updatedAt: new Date().toISOString(), version: 1, link: 'https://example.com/9', text: null, note: null,
        files: [], versions: [], steps: [], comments: 0, left: false, dueDate: null, people: [], newMessages: 0, events: [], lastAsk: null }]; w.notify('notification.changed'); });
    await expect(waiting.getByRole('button', { name: '1 new · Show' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('region', { name: 'Submission' }).getByRole('heading', { name: 'Student 2' })).toBeVisible();
    await expect(waiting.getByRole('button', { name: /Student 9/ })).toHaveCount(0);
    await waiting.getByRole('button', { name: '1 new · Show' }).click();
    await expect(waiting.getByRole('button', { name: /Student 9/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Submission' }).getByRole('heading', { name: 'Student 2' })).toBeVisible();
    // Reopening the link lands on the same person.
    await open(page, 1440, '?review=c3');
    await expect(page.getByRole('region', { name: 'Submission' }).getByRole('heading', { name: 'Student 3' })).toBeVisible();
});

test('review queue §4b.2: past the first page the rest load near the end, with Load more', async ({ page }) => {
    await open(page, 1440, '?paged');
    const waiting = page.getByRole('region', { name: 'Waiting' });
    await expect(waiting.getByRole('button', { name: /Student 4/ })).toBeVisible();
    await expect(waiting.getByRole('button', { name: 'Load more' })).toHaveCount(0);
});

test('review queue §4b.5–§4b.7, §4b.10: new messages, how late, the group, a second reviewer', async ({ page }) => {
    await open(page, 1440, '?viewers');
    const waiting = page.getByRole('region', { name: 'Waiting' });
    await expect(waiting.getByRole('button', { name: /Student 2/ })).toContainText('New message');
    await expect(waiting.getByRole('button', { name: /Student 1/ })).toContainText('Late');
    await expect(waiting.getByRole('button', { name: /Student 1/ })).toContainText('Resubmitted');
    const work = page.getByRole('region', { name: 'Submission' });
    await expect(work).toContainText('Priya is looking at this');
    await expect(waiting.getByRole('button', { name: /Student 1/ })).toContainText('Priya is here');
    expect(await axeViolations(page)).toEqual([]);
    await waiting.getByRole('button', { name: /Student 2/ }).click();
    await expect(waiting.getByRole('button', { name: /Student 2/ })).not.toContainText('New message');
    expect(await page.evaluate(() => (window as unknown as { read?: string[] }).read)).toEqual(['c2']);
    await waiting.getByRole('button', { name: /Student 3/ }).click();
    await expect(page.getByRole('region', { name: 'Discussion' }).getByRole('combobox', { name: 'Add a comment' })).toHaveAttribute('data-placeholder', 'Write to Student 3…');
});

test('review queue §4b.11, keys: empty and no-match states have their buttons; ? lists the keys; J moves and says who', async ({ page }) => {
    await open(page, 1440);
    await page.locator('body').click({ position: { x: 5, y: 890 } });
    await page.keyboard.press('j');
    await expect(page.getByRole('region', { name: 'Submission' }).getByRole('heading', { name: /Student/ })).toBeFocused();
    await expect(page.getByText(/^Now reviewing Student \d, 2 of 3$/)).toBeAttached();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('Approve');
    await page.keyboard.press('Escape');
    await page.getByRole('textbox', { name: 'Search names' }).fill('nobody');
    await expect(page.getByRole('status').filter({ hasText: 'Nobody matches these filters' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('textbox', { name: 'Search names' })).toHaveValue('');
    const none = await bundle('');
    await open(page, 1440, '', none);
    await expect(page.getByRole('status').filter({ hasText: 'All caught up' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to the board' })).toBeVisible();
});

test('review queue §4b.8: an ordinary task shows its description and files', async ({ page }) => {
    const task = await bundle(`{kind:'task',mine:true,copyId:'t1',masterId:'tasks',title:'Slides',who:'Ravi',submittedBy:null,submittedAt:new Date().toISOString(),late:false,href:'?tab=tasks&drawerId=t1',projectId:'org',
      updatedAt:new Date().toISOString(),version:null,link:null,text:null,note:null,files:[{nodeId:'n1',name:'lab3-report.pdf',size:1000}],versions:[],steps:[],comments:0,left:false,dueDate:null,people:[],newMessages:0,events:[],lastAsk:null,description:'Make 5 slides about heaps.'}`);
    await open(page, 1440, '', task);
    const work = page.getByRole('region', { name: 'Submission' });
    await expect(work).toContainText('Make 5 slides about heaps.');
    await expect(work.getByTitle('Preview of lab3-report.pdf')).toBeVisible();
});

test('review card §3: one card split into three by hairlines; the selected person looks like the main navigation, no orange bar', async ({ page }) => {
    await open(page, 1440);
    const card = page.getByTestId('review-card');
    const style = await card.evaluate((el) => { const s = getComputedStyle(el); return { border: s.borderTopWidth, radius: s.borderTopLeftRadius, gap: s.columnGap }; });
    expect(style.border).toBe('1px');
    expect(style.radius).toBe('8px');
    expect(['normal', '0px']).toContain(style.gap);
    for (const name of ['Waiting', 'Submission']) {
        const part = page.getByRole('region', { name });
        expect(await part.evaluate((el) => getComputedStyle(el).borderRightWidth)).toBe('1px');
        expect(await part.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px');
    }
    const selected = page.getByRole('region', { name: 'Waiting' }).getByRole('button', { name: /Student 1/ });
    const looks = await selected.evaluate((el) => {
        const probe = document.createElement('a'); probe.className = 'nb-nav-link'; probe.setAttribute('aria-current', 'page'); document.body.appendChild(probe);
        const nav = getComputedStyle(probe); const mine = getComputedStyle(el);
        const out = { bg: [mine.backgroundColor, nav.backgroundColor], radius: [mine.borderTopLeftRadius, nav.borderTopLeftRadius], shadow: mine.boxShadow };
        probe.remove(); return out;
    });
    expect(looks.bg[0]).toBe(looks.bg[1]);
    expect(looks.radius[0]).toBe(looks.radius[1]);
    expect(looks.shadow).toBe('none');
});
