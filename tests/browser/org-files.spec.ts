import { exportedNames, serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from './axe';

// Files report §1–§2: Submissions, Sprint materials and Final files browse the Task files way.
const origin = 'https://org-files.test';
let script: string, css: string;
const day = (n: number) => `new Date(Date.now()+(${n})*864e5).toISOString()`;
const file = (id: string, name: string, size: number, at: number, by = 'Rama') => `{nodeId:'${id}',name:'${name}',size:${size},updatedAt:${day(at)},by:'${by}',byAvatarUrl:null}`;

test.beforeAll(async () => {
  const mocks: Record<string, string> = {
    'next/link': `import React from 'react';export default ({href,children,prefetch,...p})=>React.createElement('a',{href,...p},children);`,
    '@/hooks/use-auth': `export const useAuth=()=>({user:{id:'u1'}});`,
    'next/dynamic': `import React from 'react';export default (load)=>{const C=React.lazy(()=>load().then((m)=>({default:m.default??m})));return (p)=>React.createElement(React.Suspense,{fallback:null},React.createElement(C,p));};`,
    '@/components/workspaces/v2/preview/UniversalPreviewEngine': `import React from 'react';export default ({node,fileUrl})=>React.createElement('div',{title:'Preview of '+node.name,'data-url':fileUrl},node.name);`,
    '@/app/actions/files/nodes': `export const getNodesByIds=async(p,ids)=>ids.map((id)=>({id,name:id+'.pdf',type:'file',mimeType:null}));export const getWorkspaceNodes=async()=>({success:true,data:{nodes:[]}});`,
    '@/app/actions/files/content': `export const getFilePreviewUrl=async(p,n,d)=>({url:'/files/'+p+'/'+n+(d?'?download=1':'')});`,
    '@/app/actions/org-files': `
      const row=(copyId,who,status,files,version,late,at,extra={})=>({copyId,who,files,version,submittedAt:at,late,status,by:who,projectId:'org',avatarUrl:null,team:false,...extra});
      export const readOrgSubmissionsAction=async()=>({success:true,assignments:[
        {id:'alm',title:'ALM-1',dueDate:null,reviewRequired:true,closed:false,rows:[row('c1','Rama','In review',1,1,false,${day(-0.5)}),row('c2','Asha Nair','Returned',2,2,true,${day(-2)}),row('c3','Team Falcon','In review',3,1,false,${day(-1)},{team:true,by:'Kiran',projectId:'falcon'})]},
        {id:'home',title:'Home assignment 1',dueDate:null,reviewRequired:true,closed:false,rows:[row('c4','Rama','Approved',2,3,false,${day(-1)})]},
        {id:'lab1',title:'Lab 1: Arrays and linked lists',dueDate:null,reviewRequired:true,closed:true,rows:[row('c5','Rama','Approved',2,2,false,${day(-3)})]}]});
      export const readHandInFilesAction=async(copyId)=>({success:true,projectId:copyId==='c3'?'falcon':'org',current:[${file('n1', 'ticket.pdf', 222000, -0.5)}],
        versions:copyId==='c2'?[{version:1,at:${day(-5)},files:[${file('n0', 'draft.pdf', 1000, -5)}]}]:[]});
      export const readOrgSprintMaterialsAction=async()=>({success:true,groups:[
        {sprintId:'co1',sprint:'CO1',status:'active',startDate:${day(-20)},endDate:${day(20)},parentId:null,parentName:null,files:[${file('m1', 'syllabus.pdf', 5000, -20, 'Ms. Rao')}]},
        {sprintId:'w1',sprint:'Week 3–4',status:'active',startDate:${day(-3)},endDate:${day(10)},parentId:'co1',parentName:'CO1',files:[${file('m2', 'linked-lists.pdf', 9000, -2, 'Ms. Rao')}]},
        {sprintId:'old',sprint:'Intro',status:'completed',startDate:${day(-60)},endDate:${day(-30)},parentId:null,parentName:null,files:[${file('m3', 'intro.pdf', 2000, -60, 'Ms. Rao')}]}]});
      export const readChildFinalFilesAction=async()=>({success:true,orgTitle:'CSE 3B',rows:[
        {nodeId:'g1',name:'parser.zip',assignment:'Milestone 2',assignmentId:'ms2',review:'In review',size:4096,updatedAt:${day(-1)},by:'Kiran'},
        {nodeId:'g2',name:'report.pdf',assignment:'Milestone 1',assignmentId:'ms1',review:'Reviewed by CSE 3B',size:2048,updatedAt:${day(-9)},by:'Asha'}]});`,
  };
  for (const [spec, source] of [['@/app/actions/org-files', 'src/app/actions/org-files.ts'], ['@/app/actions/files/nodes', 'src/app/actions/files/nodes.ts'], ['@/app/actions/files/content', 'src/app/actions/files/content.ts']] as const) {
    const own = new Set(exportedNames(mocks[spec]!));
    mocks[spec] += exportedNames(await readFile(source, 'utf8')).filter((n) => !own.has(n)).map((n) => `export const ${n}=async()=>({success:false,error:'Not in this fixture'});`).join('');
  }
  const out = await build({ entryPoints: [path.resolve('tests/browser/org-files.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'org-files', setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
  } }, serverActionsPlugin] });
  script = out.outputFiles![0]!.text;
  css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, query = '', width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await page.route(origin + '/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/files/')) return route.fulfill({ body: '%PDF-1.4', contentType: 'application/pdf' });
    const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html lang="en"><head><title>Files</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
    return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.goto(`${origin}/org/cse-3b${query}`);
}
const rows = (page: Page) => page.getByTestId('browser-row');

test('files §1: Submissions — the filter bar with counts, the Task files columns, assignments as folders with their badges', async ({ page }) => {
  await open(page, '?tab=files&filesView=submissions');
  const bar = page.getByRole('toolbar', { name: 'Status filters' });
  await expect(bar.getByRole('button')).toHaveText([/All\s*5/, /In review\s*2/, /Returned\s*1/, /Approved\s*2/, /Late\s*1/]);
  await expect(page.getByRole('columnheader')).toHaveText([/Name/, /Handed in/, /Files/, /By/, /Actions/]);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).filter({ hasText: 'ALM-1' })).toContainText('2 to review');
  await expect(rows(page).filter({ hasText: 'Home assignment 1' })).toContainText('All approved');
  await expect(rows(page).filter({ hasText: 'Lab 1' })).toContainText('Closed');
  // Filters narrow the folders; no match offers Clear filters.
  await bar.getByRole('button', { name: /Returned/ }).click();
  await expect(rows(page)).toHaveText([/ALM-1/]);
  await page.getByRole('searchbox', { name: 'Filter people' }).fill('nobody');
  await expect(page.getByRole('status')).toContainText('No hand-ins match these filters');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows(page)).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Assignment' }).selectOption({ label: 'Home assignment 1' });
  await expect(rows(page)).toHaveText([/Home assignment 1/]);
  await page.getByRole('combobox', { name: 'Assignment' }).selectOption({ label: 'All assignments' });
  // Download all for every assignment in the header; each folder's ⋯ has its own.
  await page.getByRole('button', { name: 'Download all' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['ALM-1', 'Home assignment 1', 'Lab 1: Arrays and linked lists']);
  await page.keyboard.press('Escape');
  await rows(page).filter({ hasText: 'ALM-1' }).getByRole('button', { name: 'More for ALM-1' }).click();
  await expect(page.getByRole('menuitem', { name: 'Download all' })).toHaveAttribute('href', '/api/v1/workspaces/org/tasks/alm/submissions');
  await expect(page.getByRole('menuitem', { name: 'Open in Tasks' })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test('files §1: open an assignment, a person, a file — breadcrumb, Esc goes up, and the place is in the link', async ({ page }) => {
  await open(page, '?tab=files&filesView=submissions');
  await rows(page).filter({ hasText: 'ALM-1' }).click();
  await expect(page).toHaveURL(/assignment=alm/);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(/Submissions\s*ALM-1/);
  await expect(page.getByRole('columnheader')).toHaveText([/Name/, /Handed in/, /Files/, /By/, /Actions/]);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).filter({ hasText: 'Asha Nair' })).toContainText(/v2.*Returned.*Late/);
  await rows(page).filter({ hasText: 'Rama' }).getByRole('button', { name: 'More for Rama' }).click();
  await expect(page.getByRole('menuitem', { name: 'Open in review' })).toHaveAttribute('href', '/org/cse-3b?tab=tasks&taskScope=review&assignment=alm&review=c1');
  await page.keyboard.press('Escape');
  // A person's folder: their files, and earlier versions as folders.
  await rows(page).filter({ hasText: 'Asha Nair' }).click();
  await expect(page).toHaveURL(/copy=c2/);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(/Submissions\s*ALM-1\s*Asha Nair/);
  await expect(rows(page)).toHaveText([/ticket\.pdf.*217 KB/, /Version 1 · \w{3} \d+.*Earlier/]);
  await rows(page).filter({ hasText: 'Version 1' }).click();
  await expect(rows(page)).toHaveText([/draft\.pdf/]);
  await page.locator('body').click({ position: { x: 5, y: 890 } });
  await page.keyboard.press('Escape');
  await expect(rows(page).first()).toContainText('ticket.pdf');
  // A file opens in the shared viewer; the link reopens it.
  await rows(page).filter({ hasText: 'ticket.pdf' }).click();
  await expect(page.getByTitle('Preview of n1.pdf')).toBeVisible();
  await expect(page).toHaveURL(/file=n1/);
  await open(page, '?tab=files&filesView=submissions&assignment=alm&copy=c3&file=n1');
  await expect(page.getByTitle('Preview of n1.pdf')).toHaveAttribute('data-url', '/files/falcon/n1');
  await page.locator('body').click({ position: { x: 5, y: 890 } });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText('Submissions');
});

test('files §2: Sprint materials — sprints as folders with their CO, a Now badge, CO materials marked, Add materials for admins', async ({ page }) => {
  await open(page, '?tab=files&filesView=materials&view=materials');
  const bar = page.getByRole('toolbar', { name: 'Sprints filters' });
  await expect(bar.getByRole('button')).toHaveText([/All\s*3/, /Running\s*2/, /Upcoming\s*0/, /Closed\s*1/]);
  await expect(rows(page)).toHaveText([/Intro/, /^CO1Now/, /CO1 · Week 3–4.*Now.*2 files/]);
  await bar.getByRole('button', { name: /Closed/ }).click();
  await expect(rows(page)).toHaveText([/Intro/]);
  await bar.getByRole('button', { name: /All/ }).click();
  await rows(page).filter({ hasText: 'Week 3–4' }).click();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(/Sprint materials\s*CO1 · Week 3–4/);
  await expect(rows(page)).toHaveText([/linked-lists\.pdf/, /syllabus\.pdf.*From CO1/]);
  await expect(page.getByRole('link', { name: 'Add materials' })).toHaveAttribute('href', '/org/cse-3b?tab=sprints&sprintId=w1');
  await rows(page).filter({ hasText: 'linked-lists.pdf' }).click();
  await expect(page.getByTitle('Preview of m2.pdf')).toBeVisible();
  await open(page, '?tab=files&filesView=materials&view=materials&member&sprint=w1');
  await expect(page.getByRole('link', { name: 'Add materials' })).toHaveCount(0);
});

test('files §1: a team workspace’s Final files — assignments as folders, then the files with their review', async ({ page }) => {
  await open(page, '?tab=files&filesView=submissions&child');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText('Final files');
  await expect(rows(page)).toHaveText([/Milestone 2.*In review/, /Milestone 1.*Reviewed/]);
  await rows(page).filter({ hasText: 'Milestone 1' }).click();
  await expect(rows(page)).toHaveText([/report\.pdf.*Reviewed by CSE 3B/]);
  await rows(page).first().click();
  await expect(page.getByTitle('Preview of g2.pdf')).toHaveAttribute('data-url', '/files/falcon/g2');
});

test('files §1–§2 on a phone: nothing scrolls sideways', async ({ page }) => {
  for (const q of ['?tab=files&filesView=submissions', '?tab=files&filesView=materials&view=materials', '?tab=files&filesView=submissions&assignment=alm']) {
    await open(page, q, 390);
    await expect(rows(page).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  }
});
