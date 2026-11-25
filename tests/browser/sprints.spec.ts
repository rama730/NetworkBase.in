import { exportedNames, serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from './axe';

// Sprint redesign (docs/superpowers/plans/2026-11-04-sprint-redesign.md): a normal workspace's Sprints tab.
const origin = 'https://sprints.test';
let script: string, css: string;

const detail = `
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10) + 'T00:00:00.000Z';
const which = new URLSearchParams(location.search).get('sprint') ?? 'running';
const orgMode = new URLSearchParams(location.search).has('org');
const base = { projectId: 'w1', goal: null, description: null, startedAt: null, completedAt: null, archivedAt: null, cancelledAt: null, createdAt: day(-30), updatedAt: day(-1) };
const sprints = [
  { ...base, id: 's3', sprintNumber: 3, code: 'SPR-3', name: 'Sprint 3 · Auth', status: 'completed', startDate: day(-17), endDate: day(-4), completedAt: day(-4) },
  { ...base, id: 's4', sprintNumber: 4, code: 'SPR-4', name: 'Sprint 4 · Search', status: 'active', startDate: day(which === 'ended' ? -14 : -3), endDate: day(which === 'ended' ? -1 : 8), goal: 'People can search projects by name and tag, under 300 ms.' },
  { ...base, id: 's5', sprintNumber: 5, code: 'SPR-5', name: 'Sprint 5 · Payments', status: 'planning', startDate: day(9), endDate: day(20) },
  { ...base, id: 's6', sprintNumber: 6, code: 'SPR-6', name: 'Sprint 6', status: 'planning', startDate: day(25), endDate: day(36) },
];
const person = (id, fullName) => ({ id, fullName, avatarUrl: null });
const t = (id, title, status, points, assignee, extra = {}) => ({ id: 'r' + id, kind: 'task', occurredAt: day(-1), task: { assignmentProgress: null, id, projectId: 'w1', sprintId: 's4', taskNumber: Number(id.slice(1)), title, description: null,
  status, reviewStatus: 'none', priority: 'medium', storyPoints: points, dueDate: null, createdAt: day(-3), updatedAt: day(-1), completedAt: status === 'done' ? day(-1) : null, activityAt: day(-1),
  linkedFileCount: 0, isDeleted: false, membershipState: 'committed', addedAt: day(-3), removedAt: null, linkedFiles: [], subtasks: [], assignee, creator: null, ...extra } });
// Board/review report §6: ?org= makes s4 a Unit (Unit 1) holding two weeks, w1 running and w2 upcoming.
if (orgMode) {
  sprints[1] = { ...sprints[1], name: 'Unit 1 Arrays and lists', startDate: day(-17), endDate: day(25) };
  sprints.push({ ...base, id: 'w1', sprintNumber: 7, code: 'SPR-7', name: 'Week 3–4', status: 'active', startDate: day(-3), endDate: day(10), parentSprintId: 's4' },
    { ...base, id: 'w2', sprintNumber: 8, code: 'SPR-8', name: 'Week 5–6', status: 'planning', startDate: day(new URLSearchParams(location.search).has('gap') ? 14 : 11), endDate: day(20), parentSprintId: 's4' });
  sprints[2] = { ...sprints[2], startDate: day(26), endDate: day(40) };
  sprints[3] = { ...sprints[3], startDate: day(41), endDate: day(52) };
}
const selected = which === 'upcoming' ? 's5' : which === 'inside' ? 'w1' : 's4';
export const useSprintDetail = () => ({ isLoading: false, isError: false, error: null, refetch() {}, fetchNextPage() {}, hasNextPage: false, isFetchingNextPage: false, data: {
  projectId: 'w1', projectSlug: 'search-app', sprints, selectedSprintId: selected,
  permissions: { canRead: true, canWrite: true, canCreate: true, canStart: true, canComplete: true, isOwner: true, isMember: false, memberRole: 'owner' },
  summary: selected === 's5' ? { totalTasks: 0, completedTasks: 0, blockedTasks: 0, linkedFileCount: 0, totalStoryPoints: 0, completedStoryPoints: 0, completionPercentage: 0 }
    : { totalTasks: 5, completedTasks: 1, blockedTasks: 1, linkedFileCount: 0, totalStoryPoints: 26, completedStoryPoints: 5, completionPercentage: 20 },
  rows: selected === 's5' ? [] : [{ id: 'k', kind: 'kickoff', occurredAt: day(-3), sprint: sprints[1] },
    t('t1', 'Search API with tag filter', 'in_progress', 5, person('u1', 'Ravi Kumar')), t('t2', 'Search box on the top bar', 'in_progress', 3, person('u2', 'Asha Nair')),
    t('t3', 'Index rebuild job', 'blocked', 8, person('u1', 'Ravi Kumar')), t('t4', 'Empty results page', 'todo', 5, null), t('t5', 'Search spec', 'done', 5, person('u2', 'Asha Nair')),
    t('t6', 'Old idea', 'todo', 2, null, { membershipState: 'historical' }),
    // Sprint cleanup §4: a main assignment with everyone's stages, and one person's own copy.
    ...(orgMode ? [t('t7', 'Lab 2: Linked lists', 'in_progress', null, null, { description: 'Implement a singly linked list.', assignmentProgress: { done: 10, total: 40 }, assignmentStages: {
      counts: { done: 10, submitted: 6, returned: 2, in_progress: 14, not_started: 5, missing: 3, excused: 1 }, total: 40, reviewRequired: true, teams: false,
      names: { done: [], submitted: ['Asha', 'Kiran', 'Priya', 'Ravi', 'Meena'], returned: ['Arjun', 'Sita'], in_progress: ['Leo'], not_started: ['Uma', 'Vik'], missing: ['Zed', 'Yan', 'Xi'], excused: ['Wu'] },
      remind: { not_started: ['c1', 'c2', 'c3', 'c4', 'c5'], missing: ['c6', 'c7', 'c8'] } } }),
      t('t8', 'Lab 1: Arrays', 'in_progress', null, person('u1', 'Ravi Kumar'), { assignmentId: 'm1', copyStage: { state: 'returned', late: false, since: day(-1), reason: 'Fix the README', fixBy: day(2), version: 2, reviewRequired: true, handIn: { link: 'https://github.com/ravi/arrays', text: null } } })] : [])],
  nextCursor: null, hasMore: false, org: null, materials: [],
  people: [{ id: 'u1', name: 'Ravi Kumar', avatarUrl: null, openTasks: 2, openPoints: 13 }, { id: 'u2', name: 'Asha Nair', avatarUrl: null, openTasks: 1, openPoints: 3 }],
  unassigned: { tasks: 1, points: 5 }, velocity: { last: 21, average: 23 },
  ...(orgMode ? {
    org: { kind: 'org', orgSprints: [], orgTitle: 'CSE 3B', orgSlug: 'cse', parentSprint: null, runningOrgSprint: null, linkedProjects: [], notLinkedCount: 1, notLinked: [{ projectId: 'c1', title: 'Team Falcon', slug: 'falcon' }],
      groupBacklog: 0, followsOrgSprints: false, termEnd: null, sprintFlags: {}, children: [{ id: 'c1', title: 'Team Falcon' }], orgType: 'education', words: { main: 'Unit', inner: 'Week', plan: 'Term', isClass: true }, defaults: { autoStart: true, showInChildren: true, createMatching: false, notifyOnStart: true } },
    children: selected === 's4' ? [{ id: 'w1', name: 'Week 3–4', code: 'SPR-7', status: 'active', startDate: day(-3), endDate: day(10), done: 3, total: 9 }, { id: 'w2', name: 'Week 5–6', code: 'SPR-8', status: 'planning', startDate: day(11), endDate: day(20), done: 0, total: 0 }] : undefined,
    openAssignments: 2,
  } : {}),
} });`;

test.beforeAll(async () => {
  const mocks: Record<string, string> = {
    'next/link': `import React from 'react';export default ({href,children,prefetch,...p})=>React.createElement('a',{href,...p},children);`,
    '@/hooks/use-auth': `export const useAuth=()=>({user:{id:'u1'}});`,
    'next/dynamic': `import React from 'react';export default (load)=>{const C=React.lazy(()=>load().then((m)=>({default:m.default??m})));return (p)=>React.createElement(React.Suspense,{fallback:null},React.createElement(C,p));};`,
    '@/hooks/workspaces/useWorkspaceTasksData': detail,
    '@/app/actions/workspace': `export const readSprintBacklogAction=async({query})=>({success:true,rows:[{id:'b1',title:'Refund flow',storyPoints:5,assignee:null,status:'todo',kind:'task'},{id:'b2',title:'Invoice PDF',storyPoints:3,assignee:'Asha Nair',status:'todo',kind:'task'},{id:'b3',title:'Retry payouts',storyPoints:null,assignee:null,status:'todo',kind:'task'}].filter((r)=>r.title.toLowerCase().includes(query.toLowerCase()))});
      export const createSprintAction=async(input)=>{(window.created??=[]).push(input);return {success:true,sprint:{id:'s9',code:'SPR-9'}}};`,
    '@/app/actions/plan-hand-in': `export const readMyPlanItemsAction=async()=>({success:true,courses:[]});export const submitPlanItemAction=async()=>({success:true});`,
    '@/app/actions/assignments': `export const remindCopiesAction=async(masterId,ids)=>{(window.reminded??=[]).push([masterId,ids]);return {success:true,reminded:ids.length,skipped:0}};`,
    '@/app/actions/task': `export const addTasksToSprintAction=async(input)=>{(window.added??=[]).push(input);return {added:input.taskIds.length,failed:[]}};`,
  };
  for (const [spec, source] of [['@/hooks/workspaces/useWorkspaceTasksData', 'src/hooks/workspaces/useWorkspaceTasksData.ts'], ['@/app/actions/workspace', 'src/app/actions/workspace/index.ts'], ['@/app/actions/assignments', 'src/app/actions/assignments.ts'], ['@/app/actions/task', 'src/app/actions/task.ts']] as const) {
    const own = new Set(exportedNames(mocks[spec]!));
    mocks[spec] += exportedNames(await readFile(source, 'utf8')).filter((n) => !own.has(n)).map((n) => `export const ${n}=async()=>({success:false,error:'Not in this fixture'});`).join('');
  }
  const out = await build({ entryPoints: [path.resolve('tests/browser/sprints.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'sprints', setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
  } }, serverActionsPlugin] });
  script = out.outputFiles![0]!.text;
  css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, sprint = 'running', width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.route(origin + '/**', (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html lang="en"><head><title>Sprints</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
    return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.goto(`${origin}/?sprint=${sprint}`);
  await expect(page.getByRole('heading', { name: /Sprint [45]|Unit 1|Week 3–4/ }).first()).toBeVisible();
}

test('§5, §8: the rail is the term, the header has the goal and one main button, time and points sit side by side, work groups by state, People shows the load', async ({ page }) => {
  await open(page);
  const rail = page.getByRole('complementary', { name: 'Sprints' });
  for (const name of ['Now', 'Next', 'Later']) await expect(rail.getByRole('heading', { name })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Past · 1' })).toHaveAttribute('aria-expanded', 'false');
  await expect(rail).toContainText(/day 4 of 12/);
  await expect(rail).toContainText(/starts in 9 days/);
  await expect(rail).toContainText('No sprint planned');
  await expect(rail.getByRole('link', { name: /Backlog/ })).toHaveAttribute('href', '?tab=tasks&taskScope=backlog');
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  await expect(page.getByText('People can search projects by name and tag, under 300 ms.')).toBeVisible();
  // 2026-11-09: Add work moved into New sprint; the header has no Add work and no Calendar.
  await expect(page.locator('header').getByRole('button', { name: 'Add work' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Calendar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Close Sprint/ })).toHaveCount(0);
  const summary = page.getByLabel('Sprint summary');
  await expect(summary).toContainText('Points done · 5 of 26');
  await expect(summary).toContainText('1 blocked');
  for (const name of ['In progress · 2', 'Blocked · 1', 'To do · 1', 'Done · 1']) await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('Taken out of this sprint · 1')).toBeVisible();
  await page.getByLabel('Group by').selectOption('person');
  await expect(page.getByRole('heading', { name: 'Nobody yet · 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Mine' }).click();
  await expect(page.getByRole('heading', { name: 'Ravi Kumar · 2' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Asha Nair · 2' })).toHaveCount(0);
  const people = page.getByRole('region', { name: 'People' });
  await expect(people).toContainText(/Ravi Kumar\s*13 · 2 tasks · heavy/);
  await expect(people).toContainText('Nobody yet');
  expect(await axeViolations(page)).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('sprints-1440.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sprint actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Complete early' })).toBeVisible();
});

test('§8.6: Add work, New sprint\'s last tab, picks a sprint and adds ticked backlog tasks', async ({ page }) => {
  await open(page);
  await page.getByRole('complementary', { name: 'Sprints' }).getByRole('button', { name: 'New sprint' }).click();
  const dialog = page.getByRole('dialog', { name: 'New' });
  await dialog.getByRole('tab', { name: 'Add work' }).click();
  await expect(dialog.getByText('Open work that isn’t in a sprint yet.')).toBeVisible();
  await expect(dialog.getByLabel('Add to')).toHaveValue('s4');
  // Kept simple: pick the sprint, tick tasks, add; no points card.
  await expect(dialog).not.toContainText('points');
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(600);
  await dialog.getByRole('checkbox', { name: /Refund flow/ }).check();
  await dialog.getByRole('checkbox', { name: /Retry payouts/ }).check();
  await dialog.getByRole('searchbox', { name: 'Search the backlog' }).fill('invoice');
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await dialog.getByRole('searchbox', { name: 'Search the backlog' }).fill('');
  await dialog.screenshot({ path: test.info().outputPath('add-work-tab.png') });
  await dialog.getByRole('button', { name: 'Add 2 tasks' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { added: unknown[] }).added)).toEqual([{ projectId: 'w1', sprintId: 's4', taskIds: ['b1', 'b3'] }]);
});

test('§6: New sprint offers one or several, folds notes, shows where it lands and names what it creates', async ({ page }) => {
  await open(page);
  await page.getByRole('complementary', { name: 'Sprints' }).getByRole('button', { name: 'New sprint' }).click();
  const dialog = page.getByRole('dialog');
  // A workspace's New has Sprint and Add work; One or Several sits with the dates.
  await expect(dialog.getByRole('tab')).toHaveText(['Sprint', 'Add work']);
  await expect(dialog.getByRole('radio', { name: 'One', exact: true })).toHaveAttribute('aria-checked', 'true');
  // Sprint redesign: the same sections as New task, Notes in Basics.
  for (const heading of ['Basics', 'Dates']) await expect(dialog.getByText(heading, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Notes' })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Sprint 7');
  await dialog.getByLabel('Starts').fill(new Date(Date.now() + 37 * 864e5).toISOString().slice(0, 10));
  await dialog.getByRole('button', { name: '2 weeks' }).click();
  await expect(dialog.getByRole('button', { name: '2 weeks' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByTestId('term-strip')).toContainText('Starts right after Sprint 6. No overlap.');
  await expect(dialog.getByText(/^\w{3} \d{1,2} \w{3} – \w{3} \d{1,2} \w{3} · 14 days \(2 weeks\) · starts in 37 days$/)).toBeVisible();
  await expect(dialog.getByText('More options')).toContainText('starts by itself');
  await expect(dialog.getByRole('button', { name: 'Create Sprint 7' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('sprint-form.png') });
  await dialog.getByLabel('Starts').fill(new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  await expect(dialog.getByTestId('term-strip')).toContainText('Overlaps Sprint 6.');
  await dialog.getByRole('radio', { name: 'Several' }).click();
  await expect(dialog.getByText(/^\d+ sprints: Sprint 7–Sprint \d+ · .+\.$/)).toBeVisible();
  await expect(dialog.getByRole('list', { name: 'Sprints to create' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Create \d+ sprints$/ })).toBeVisible();
  for (const width of [390]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  }
});

test('§4, §5.6, §8.7: an ended sprint says it needs closing; Close names the next sprint as where open work goes', async ({ page }) => {
  await open(page, 'ended');
  await expect(page.getByText('Ended', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Close it to count what’s done' })).toBeVisible();
  await page.locator('header').getByRole('button', { name: 'Close Sprint 4 · Search' }).click();
  const dialog = page.getByRole('dialog', { name: 'Close Sprint 4 · Search?' });
  await expect(dialog).toContainText('5 of 26 points done');
  await expect(dialog).toContainText('4 tasks still open go to');
  await expect(dialog.getByRole('radio', { name: /Sprint 5 · Payments/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'The backlog' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Stay here, for the record' })).toBeVisible();
});

test('§4: an upcoming sprint offers Start now; phones get the picker and no side scroll', async ({ page }) => {
  await open(page, 'upcoming');
  await expect(page.getByText('Upcoming', { exact: true })).toBeVisible();
  await expect(page.getByText(/Starts by itself in 9 days/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start now' })).toBeVisible();
  await expect(page.getByText('No work in this sprint yet')).toBeVisible();
  await open(page, 'running', 390);
  await expect(page.getByLabel('Select sprint')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: test.info().outputPath('sprints-390.png'), fullPage: true });
});

test('board/review report §6, sprint redesign: a Unit holds its weeks; its numbers lead the page; one New sprint button opens inside it; the header is Edit and ⋯', async ({ page }) => {
  await open(page, 'running&org=1');
  const rail = page.getByRole('complementary', { name: 'Sprints' });
  const inside = rail.getByRole('list', { name: 'Sprints in Unit 1 Arrays and lists' });
  await expect(inside.getByRole('link')).toHaveText([/Week 3–4/, /Week 5–6/]);
  // The Unit counts its weeks; no gap between back-to-back weeks inside it. The class rail is the Term.
  await expect(rail.getByRole('heading', { name: 'Term' })).toBeVisible();
  await expect(rail.getByRole('link', { name: /Unit 1 Arrays and lists/ })).toContainText(/week \d+ of 7/);
  await expect(inside.getByText('No sprint planned')).toHaveCount(0);
  await expect(page.locator('header').getByText(/^week \d+ of 7$/)).toBeVisible();
  // One sprint button only; the header is Edit and ⋯ (Add work is New's last tab, Calendar is gone).
  await expect(page.getByRole('button', { name: /Add a sprint inside/ })).toHaveCount(0);
  const actions = page.locator('header').getByRole('button');
  await expect(actions).toHaveText([/Edit/, '']);
  // Sprint redesign: one row of numbers for the Unit, then its weeks with a bar each; no second set of sprint cards.
  const glance = page.getByRole('region', { name: 'Unit 1 Arrays and lists at a glance' });
  await expect(glance).toContainText('Points done · 5 of 26');
  await expect(glance).toContainText(/behind · \d+% of the time gone, \d+% done/);
  await expect(glance).toContainText(/Assignments open\s*2/);
  await expect(glance).toContainText(/Teams without a sprint\s*1\s*See who/);
  await expect(glance.getByRole('list', { name: 'Weeks in Unit 1 Arrays and lists' }).getByRole('link', { name: /Week 3–4.*3\/9 done/ })).toBeVisible();
  await expect(page.getByLabel('Sprint summary')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('unit-page.png'), fullPage: true });
  // New sprint opens on the Week tab, inside this Unit, starting after its last week.
  await rail.getByRole('button', { name: 'New sprint' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByText('A short stretch inside a unit.')).toBeVisible();
  await expect(dialog.getByLabel('Inside which unit')).toHaveValue('s4');
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue(/^Week \d+$/);
  await expect(dialog.getByRole('tab')).toHaveText(['Unit', 'Week', 'Add work']);
  await dialog.screenshot({ path: test.info().outputPath('new-sprint-inside.png') });
  await dialog.getByRole('radio', { name: 'Several' }).click();
  await expect(dialog.getByText(/^\d+ weeks: Week \d+–Week \d+ · .+, inside Unit 1 Arrays and lists\.$/)).toBeVisible();
  await dialog.getByRole('radio', { name: 'One', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Unit', exact: true }).click();
  await expect(dialog.getByLabel('Inside which unit')).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Unit 2');
  await dialog.screenshot({ path: test.info().outputPath('new-unit.png') });
  // Closing the Unit says it closes the running week and cancels the upcoming one.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Sprint actions' }).click();
  await page.getByRole('menuitem', { name: 'Complete early' }).click();
  await expect(page.getByRole('dialog').getByRole('status').filter({ hasText: 'This also' })).toHaveText('This also closes Week 3–4 and cancels Week 5–6.');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Close Unit 1 Arrays and lists' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('radio', { name: /Week 5–6/ })).toHaveCount(0);
});

test('board/review report §6: days nobody planned between weeks inside a Unit show as a gap', async ({ page }) => {
  await open(page, 'running&org=1&gap=1');
  const inside = page.getByRole('complementary', { name: 'Sprints' }).getByRole('list', { name: 'Sprints in Unit 1 Arrays and lists' });
  await expect(inside.getByRole('listitem')).toHaveCount(3);
  await expect(inside.getByRole('listitem').nth(1)).toContainText(/Gap · .*No sprint planned/);
});

test('board/review report §6: a week inside a Unit says where it sits, and the phone picker names it in full', async ({ page }) => {
  await open(page, 'inside&org=1', 390);
  await expect(page.getByText(/^Unit 1 Arrays and lists · week \d+ of 7$/)).toBeVisible();
  await expect(page.getByLabel('Select sprint').locator('option', { hasText: 'Unit 1 Arrays and lists · Week 3–4' })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('sprint cleanup §4: an assignment says where everyone is — closed and open — and a person\'s own copy says where they are', async ({ page }) => {
  await open(page, 'running&org=1');
  const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Lab 2: Linked lists' }) });
  await expect(row).toContainText('10 of 40 approved · 6 in review · 2 returned · 3 missing');
  await expect(row.getByRole('img', { name: /10 approved, 6 in review/ })).toBeVisible();
  // Sprint work list redesign: the board's look — clipboard icon (not a blank person), the assignment's own chip, who it's for.
  await expect(row.getByTitle('Assignment')).toBeVisible();
  await expect(row.getByText('6 to review', { exact: true })).toBeVisible();
  await expect(row).toContainText('Assignment · 40 people');
  await expect(row).not.toContainText('In progress');
  // A task with nobody on it shows the dashed Unassigned tile; a person's own copy says it's an assignment.
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Empty results page' }) }).getByTitle('Unassigned')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Lab 1: Arrays' }) })).toContainText(/Ravi Kumar\s*·\s*Assignment/);
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Lab 1: Arrays' }) }).getByText('Returned', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('assignment-rows.png'), fullPage: true });
  await row.getByRole('button', { name: 'Expand Lab 2: Linked lists' }).click();
  const stages = row.getByRole('list', { name: 'Where everyone is' });
  await expect(stages.getByRole('listitem')).toHaveText([/In review 6\s*Asha, Kiran, Priya, Ravi, Meena, \+1\s*Review 6/, /Returned 2\s*Arjun, Sita/, /In progress 14\s*Leo, \+13/, /Not started 5\s*Uma, Vik, \+3\s*Remind 5/, /Missing 3\s*Zed, Yan, Xi\s*Remind 3/]);
  await expect(stages.getByRole('link', { name: 'Review 6', exact: true })).toHaveAttribute('href', /taskScope=review&assignment=t7/);
  await expect(stages.getByRole('link', { name: 'Missing 3', exact: true })).toHaveAttribute('href', /drawerId=.*rosterTile=notIn/);
  await expect(stages.getByRole('link', { name: 'In review 6', exact: true })).toHaveAttribute('href', /rosterTile=submitted/);
  await stages.getByRole('button', { name: 'Remind 3' }).click();
  await expect(stages.getByRole('button', { name: 'Reminded' })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { reminded: unknown }).reminded)).toEqual([['t7', ['c6', 'c7', 'c8']]]);
  await expect(row).toContainText('Instructions: Implement a singly linked list.');
  await expect(row).not.toContainText('No description provided');
  const own = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Lab 1: Arrays' }) });
  await expect(own).toContainText(/Returned: Fix the README · fix by \w{3} \d+/);
  await own.getByRole('button', { name: 'Expand Lab 1: Arrays' }).click();
  await expect(own.getByRole('link', { name: 'https://github.com/ravi/arrays' })).toBeVisible();
  await expect(own).toContainText('Handed in (version 2):');
  // A plain task with nothing written shows who has it and when it's due, and Open.
  const plain = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Empty results page' }) });
  await plain.getByRole('button', { name: 'Expand Empty results page' }).click();
  await expect(plain).toContainText('Nobody assigned · No due date');
  await expect(plain.getByRole('link', { name: 'Open', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await row.getByRole('button', { name: 'Expand Lab 2: Linked lists' }).click();
  await expect(stages).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await row.screenshot({ path: test.info().outputPath('assignment-stages-390.png') });
  await own.screenshot({ path: test.info().outputPath('own-copy-390.png') });
});
