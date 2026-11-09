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
      export const readAssignmentComposerOptionsAction=async()=>({success:true,children:[],sprints:[{id:'co1',name:'CO1',status:'active',endDate:'2026-12-04T18:29:00.000Z'}],teamAssignments:[],admins:[],defaults:{reviewRequired:true,lateRule:'until',dueTime:'17:00'}});
      export const createAssignmentAction=async(input)=>{window.created=input;return {success:true,copies:2,masterId:'m-new'}};
      export const readAssignmentForReuseAction=async()=>({success:true,form:{title:'Array lab',description:'Implement a dynamic array',submissionType:'link',reviewRequired:true,lateRule:'always',lateAfterMinutes:15,steps:['Push','Pop'],target:{mode:'everyone'},materials:[],dueDate:null}});`,
    '@/app/actions/organizations': `export const listOrgRosterAction=async()=>[{userId:'rama',name:'Rama',username:'rama',avatarUrl:null,title:null,role:'member',projectHint:null},{userId:'asha',name:'Asha',username:'asha',avatarUrl:null,title:null,role:'member',projectHint:null}];`,
    '@/app/actions/workspace': `export const fetchWorkspaceTasksAction=async(_p,_n,_c,scope)=>({success:true,tasks:scope==='mine'?[]:window.boardTasks.filter((t)=>scope!=='sprint'||t.sprintId),nextCursor:undefined,hasMore:false});
      export const readBoardCountsAction=async()=>{window.countCalls++;return {success:true,counts:JSON.parse(JSON.stringify(window.counts))}};`,
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
  await expect(dialog.getByRole('textbox', { name: /Assignment title/ })).toHaveValue('Array lab');
  await expect(dialog.getByRole('button', { name: 'Publish to 2' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'New assignment' })).toHaveCount(0);
});

test('board/review report §6: Sprint names the running sprint in full and lists its work', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /^Show: All tasks/ }).click();
  const sprint = page.getByRole('menuitemradio', { name: /^Sprint · CO1 · Week 3–4/ });
  await expect(sprint).toBeVisible();
  await sprint.click();
  await expect(page.getByText('Stack drill', { exact: true })).toBeVisible();
  await expect(page.getByText('Queue drill', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Array lab', { exact: true })).toHaveCount(0);
});

const center = async (page: Page, locator: ReturnType<Page['getByRole']>) => { const b = (await locator.boundingBox())!; return b.y + b.height / 2; };

test('board view dropdown §2, §3: one View button with counts; search, View, Code editor and New task share one line', async ({ page }) => {
  await open(page);
  const view = page.getByRole('button', { name: /^Show: All tasks/ });
  await expect(view).toHaveAccessibleName('Show: All tasks. 7 in other views need you');
  await expect(view).toContainText('7');
  // Board N is the view's real total.
  await expect(page.getByRole('heading', { name: 'Board' }).locator('..')).toContainText('10');
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const row = await center(page, page.getByRole('button', { name: 'New task' }));
    for (const other of [view, page.getByPlaceholder('Filter tasks…')]) expect(Math.abs((await center(page, other as never)) - row)).toBeLessThan(10);
    await expect(page.getByRole('button', { name: 'New column' })).toHaveCount(0);
  }
  // Below 1280px the code editor button says "Code" so the row never wraps.
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(page.getByText('Code', { exact: true })).toBeVisible();
  expect(Math.abs((await center(page, view)) - (await center(page, page.getByRole('button', { name: 'New task' }))))).toBeLessThan(10);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByText('Code editor', { exact: true })).toBeVisible();
  // New task is the last control on the line, after ⋯.
  const right = async (name: string) => { const b = (await page.getByRole('button', { name, exact: true }).first().boundingBox())!; return b.x + b.width; };
  expect(await right('New task')).toBeGreaterThan(await right('More task actions'));
  // New column lives in ⋯.
  await page.getByRole('button', { name: 'More task actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'New column' })).toBeVisible();
  await page.keyboard.press('Escape');
  // The menu: every view with its open number, and what needs you in orange.
  await view.click();
  const items = page.getByRole('menuitemradio');
  await expect(items).toHaveText([/^All tasks, 7 open\s*7$/, /^Sprint · CO1 · Week 3–4, 1 open\s*1$/, /^Backlog, 5 open\s*5$/, /^In review, 6 open, 6 waiting for you\s*6\s*6$/, /^Assignments, 5 open\s*5$/, /^Mine, 2 open, 1 need you\s*1\s*2$/]);
  await expect(page.getByRole('menuitemradio', { name: /^In review ?, 6 open, 6 waiting for you$/ })).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: /All tasks/ })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowDown');
  await page.getByRole('menuitemradio', { name: /^Mine/ }).click();
  await expect(page.getByRole('button', { name: /^Show: Mine/ })).toHaveAccessibleName('Show: Mine. 6 in other views need you');
});

test('board view dropdown §3, §5: the numbers update after a change on the board, without a reload', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('button', { name: /^Show: All tasks/ })).toContainText('7');
  const calls = await page.evaluate(() => (window as unknown as { countCalls: number }).countCalls);
  await page.evaluate(() => { const w = window as unknown as { counts: { review: { needsYou: number } }; openCopy: () => void }; w.counts.review.needsYou = 5; w.openCopy(); });
  await expect(page.getByRole('button', { name: /^Show: All tasks/ })).toHaveAccessibleName('Show: All tasks. 6 in other views need you');
  expect(await page.evaluate(() => (window as unknown as { countCalls: number }).countCalls)).toBeGreaterThan(calls);
});

test('board view dropdown §2, §6: on a phone the views open as a sheet; an empty view says which it is', async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const view = page.getByRole('button', { name: /^Show: All tasks/ });
  const box = (await view.boundingBox())!;
  expect(box.width).toBeGreaterThan(300);
  await view.click();
  const sheet = page.getByRole('dialog', { name: 'Show' });
  await expect(sheet.getByRole('radio')).toHaveCount(6);
  await sheet.getByRole('radio', { name: /^Mine/ }).click();
  await expect(sheet).toHaveCount(0);
  const empty = page.getByRole('status').filter({ hasText: 'Nothing assigned to you' });
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('Tasks and assignments given to you show here.');
  await expect(page.getByRole('button', { name: 'New task' }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('board view dropdown §6a: an assignment card is a task card — title, where everyone is, chips, and who it is for', async ({ page }) => {
  await open(page);
  const card = (title: string) => page.getByTestId('task-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const open1 = card('Array lab');
  await expect(open1).toHaveAccessibleName(/^Assignment, Array lab, 12 of 40 approved · 2 returned · 3 missing|^Assignment, Array lab, 12 of 40 approved · 6 in review · 2 returned · 3 missing, 6 to review, due/);
  await expect(open1).toContainText('12 of 40 approved · 6 in review · 2 returned · 3 missing');
  await expect(open1.getByRole('img', { name: /12 approved, 6 in review/ })).toBeVisible();
  await expect(open1).toContainText('6 to review');
  await expect(open1).toContainText('Everyone · 40');
  await expect(open1).not.toContainText('ASSIGNMENT');
  await expect(open1.getByTitle('Unassigned')).toHaveCount(0);
  // Title first, then the line, then the chips, then the footer.
  const y = async (text: string) => (await open1.getByText(text, { exact: true }).first().boundingBox())!.y;
  expect(await y('Array lab')).toBeLessThan(await y('12 of 40 approved · 6 in review · 2 returned · 3 missing'));
  expect(await y('12 of 40 approved · 6 in review · 2 returned · 3 missing')).toBeLessThan(await y('6 to review'));
  expect(await y('6 to review')).toBeLessThan(await y('Everyone · 40'));
  await expect(card('Hash table library')).toContainText('0 of 8 groups approved · 5 working');
  await expect(card('Hash table library')).toContainText('8 groups');
  await expect(card('Lab 3: Stacks')).toContainText('Not published · goes to 40 people');
  await expect(card('Lab 3: Stacks')).toContainText('Draft');
  expect(await card('Lab 3: Stacks').evaluate((el) => getComputedStyle(el).borderStyle)).toBe('dashed');
  await expect(card('Quiz 2')).toContainText(/Publishes Nov 12, \d+:\d\d (am|pm)/);
  await expect(card('Quiz 2')).toContainText('Scheduled');
  await expect(card('Lab 1: Arrays')).toContainText('All 39 approved · 1 excused');
  expect(await card('Lab 1: Arrays').getByRole('heading').evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');
  await expect(card('Lab 4: Trees')).toContainText('Nobody has it yet. People get it when they join.');
  const own = card('Lab 2: Linked lists');
  await expect(own).toContainText('Returned: fix the README · fix by Nov 13');
  await expect(own).toContainText('Returned');
  await expect(own).toContainText('Assignment');
  await page.screenshot({ path: test.info().outputPath('board-cards.png'), fullPage: true });
});

test('assignment form redesign: the Assignment tab is laid out like Task, and a due date is one click', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.getByRole('button', { name: 'New task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New' });
  await dialog.getByRole('tab', { name: 'Assignment' }).click();
  // The same sections and the same fixed footer as the Task tab.
  for (const heading of ['Basics', 'Who gets it', 'Due and late work', 'Hand-in and review', 'Steps and materials']) await expect(dialog.getByText(heading, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  // Nothing filled in: each field says what it needs, under itself.
  await dialog.getByRole('button', { name: 'Publish to 2' }).click();
  await expect(dialog.getByText('Add a title.')).toBeVisible();
  await expect(dialog.getByText('Pick a due date.')).toBeVisible();
  // Late work counted from the due date isn't flagged on its own.
  await expect(dialog.getByText('Pick the last day late work is accepted.')).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: /Assignment title/ })).toBeFocused();
  // The time is the organization's (Settings → Work → Due time); Tomorrow fills the date.
  await expect(dialog.getByRole('combobox', { name: 'Due, time' })).toHaveValue('17:00');
  await dialog.getByRole('button', { name: 'Tomorrow' }).click();
  await expect(dialog.getByText(/^Due \w{3} \d{1,2} \w{3}, 5:00 PM · tomorrow$/)).toBeVisible();
  await expect(dialog.getByText('Pick a due date.')).toHaveCount(0);
  // Late work until starts a week after the due date and moves with it.
  await expect(dialog.getByRole('button', { name: '+1 week' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText(/^Until \w{3} \d{1,2} \w{3}, 5:00 PM · in 8 days$/)).toBeVisible();
  // Repeat weekly lists the days it makes.
  await dialog.getByRole('checkbox', { name: /Repeat weekly until/ }).check();
  await expect(dialog.getByText(/^5 assignments: .+\. Later weeks are saved as drafts/)).toBeVisible();
  await dialog.getByRole('checkbox', { name: /Repeat weekly until/ }).uncheck();
  // The rare settings wait behind More options.
  await expect(dialog.getByRole('checkbox', { name: 'Also share in #general' })).toBeHidden();
  await dialog.getByText('More options').click();
  await expect(dialog.getByRole('checkbox', { name: 'Also share in #general' })).toBeVisible();
  await dialog.getByRole('textbox', { name: /Assignment title/ }).fill('Lab 5: Graphs');
  await page.screenshot({ path: 'test-results/assignment-form.png' });
  await dialog.getByRole('button', { name: 'Publish to 2' }).click();
  await expect(dialog).toHaveCount(0);
  const created = await page.evaluate(() => (window as unknown as { created: { title: string; dueDate: string; lateUntil: string } }).created);
  expect(created.title).toBe('Lab 5: Graphs');
  expect(new Date(created.lateUntil).getTime() - new Date(created.dueDate).getTime()).toBe(7 * 864e5);
  expect(errors).toEqual([]);
});

test('assignment form redesign: picking a sprint fills an empty due date with its last day, and End of sprint appears', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'New task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New' });
  await dialog.getByRole('tab', { name: 'Assignment' }).click();
  await dialog.getByRole('combobox', { name: 'Sprint' }).selectOption('co1');
  // The fixture has no zone, so the day is the browser's; the sprint ends 18:29 UTC on 4 Dec.
  await expect(dialog.getByRole('textbox', { name: 'Due, date' })).toHaveValue(/^2026-12-0[45]$/);
  await expect(dialog.getByRole('button', { name: 'End of sprint' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('option', { name: 'When the sprint starts' })).toBeAttached();
});
