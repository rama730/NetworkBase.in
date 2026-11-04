import { exportedNames, serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';

const origin = 'https://org-board.test';
let script: string, css: string;

test.beforeAll(async () => {
  const mocks: Record<string, string> = {
    'next/link': `import React from 'react';export default ({href,children,prefetch,...p})=>React.createElement('a',{href,...p},children);`,
    'next/navigation': `export const usePathname=()=>'/org/cse-3b',useRouter=()=>({refresh(){},push(){},replace(){}}),useSearchParams=()=>new URLSearchParams();`,
    'next/dynamic': `import React from 'react';export default (load)=>{const L=React.lazy(()=>load().then((m)=>({default:m.default??m})));return (p)=>React.createElement(React.Suspense,{fallback:null},React.createElement(L,p));};`,
    '@/hooks/useRealtimeTasks': `export const useRealtimeTasks=()=>{};`,
    '@/lib/realtime/private-broadcast': `export const subscribeBroadcast=()=>({unsubscribe(){}});`,
    '@/hooks/use-auth': `export const useAuth=()=>({user:{id:'me'},profile:{id:'me',username:'me',fullName:'Me',avatarUrl:null}});`,
    '@/app/actions/child-units': `export const readWorkspaceUnitsAction=async()=>[];`,
    // The card's panel, cut to the part this test needs: the assignment's own actions (Use again).
    '@/components/workspaces/v2/tasks/TaskDetailPanel': `import React from 'react';import { AssignmentManageSection } from '@/components/organizations/AssignmentsPanel';export default ({task})=>task?React.createElement(AssignmentManageSection,{orgId:'org',masterId:task.id}):null;`,
    '@/app/actions/assignments': `const counts={not_started:0,in_progress:1,submitted:1,returned:0,done:0,missing:0,excused:0,total:2};
      export const listAssignmentsAction=async()=>({success:true,isAdmin:true,timeZone:null,rows:[{masterId:'master-1',title:'Array lab',dueDate:null,status:'open',submissionType:'file',reviewRequired:true,teams:false,counts,mine:null}]});
      export const readAssignmentComposerOptionsAction=async()=>({success:true,children:[],sprints:[],teamAssignments:[],admins:[],defaults:{reviewRequired:true,lateRule:'always'}});
      export const readAssignmentForReuseAction=async()=>({success:true,form:{title:'Array lab',description:'Implement a dynamic array',submissionType:'link',reviewRequired:true,lateRule:'always',lateAfterMinutes:15,steps:['Push','Pop'],target:{mode:'everyone'},materials:[],dueDate:null}});`,
    '@/app/actions/organizations': `export const listOrgRosterAction=async()=>[{userId:'rama',name:'Rama',username:'rama',avatarUrl:null,title:null,role:'member',projectHint:null},{userId:'asha',name:'Asha',username:'asha',avatarUrl:null,title:null,role:'member',projectHint:null}];`,
    '@/app/actions/workspace': `export const fetchWorkspaceTasksAction=async(_p,_n,_c,scope)=>({success:true,tasks:window.boardTasks.filter((t)=>scope!=='sprint'||t.sprintId),nextCursor:undefined,hasMore:false});`,
    '@/app/actions/moderation': `export const moderatedItemsAction=async()=>[];`,
    '@/app/actions/workspace/workflow': `export const getWorkspaceWorkflowColumnsAction=async()=>({success:true,columns:[['todo','To do'],['in_progress','In progress'],['done','Completed']].map(([status,title],i)=>({id:'col-'+status,projectId:'org',status,title,accentClassName:'',emptyTitle:'Nothing here',emptyDescription:'',position:i,isDefault:true,createdAt:new Date(),updatedAt:new Date()}))});`,
  };
  // Pad mocked actions modules: anything not named here refuses, like an unmocked server action.
  for (const [mod, file] of [['@/app/actions/child-units', 'src/app/actions/child-units.ts'], ['@/app/actions/workspace/workflow', 'src/app/actions/workspace/workflow.ts'],
    ['@/app/actions/assignments', 'src/app/actions/assignments.ts'], ['@/app/actions/workspace', 'src/app/actions/workspace/index.ts'], ['@/app/actions/organizations', 'src/app/actions/organizations.ts']] as const) {
    const own = new Set(exportedNames(mocks[mod]!));
    mocks[mod] += exportedNames(await readFile(file, 'utf8')).filter((n) => !own.has(n)).map((n) => `export const ${n}=async()=>({success:false,error:'not in this test'});`).join('');
  }
  const out = await build({ entryPoints: [path.resolve('tests/browser/org-board.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'org-board', setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
  } }, serverActionsPlugin] });
  script = out.outputFiles![0]!.text;
  css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(origin + '/**', (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html lang="en"><head><title>Board</title><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
    return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.goto(`${origin}/org/cse-3b`);
}

test('board/review report §1: opening a student\'s copy leaves the admin\'s board with one card for the assignment', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await open(page);
  const cards = page.getByText('Array lab', { exact: true });
  await expect(cards).toHaveCount(1);
  for (let i = 0; i < 3; i++) await page.evaluate(() => (window as unknown as { openCopy: () => void }).openCopy());
  await page.waitForTimeout(300);
  await expect(cards).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('board/review report §4: Use again on an assignment\'s card opens New on its Assignment tab, filled in', async ({ page }) => {
  await open(page);
  await page.getByText('Array lab', { exact: true }).click();
  await page.getByRole('button', { name: 'Manage assignment' }).click();
  await page.getByRole('menuitem', { name: 'Use again' }).click();
  const dialog = page.getByRole('dialog', { name: 'New' });
  await expect(dialog.getByRole('tab', { name: 'Assignment' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('textbox', { name: /Title/ })).toHaveValue('Array lab');
  await expect(dialog.getByRole('button', { name: 'Publish to 2' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'New assignment' })).toHaveCount(0);
});

test('board/review report §6: Sprint names the running sprint in full and lists its work', async ({ page }) => {
  await open(page);
  const sprint = page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Sprint/ });
  await expect(sprint).toHaveText('Sprint· CO1 · Week 3–4');
  await sprint.click();
  await expect(page.getByText('Stack drill', { exact: true })).toBeVisible();
  await expect(page.getByText('Queue drill', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Array lab', { exact: true })).toHaveCount(0);
});
