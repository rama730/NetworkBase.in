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
const selected = which === 'upcoming' ? 's5' : 's4';
export const useSprintDetail = () => ({ isLoading: false, isError: false, error: null, refetch() {}, fetchNextPage() {}, hasNextPage: false, isFetchingNextPage: false, data: {
  projectId: 'w1', projectSlug: 'search-app', sprints, selectedSprintId: selected,
  permissions: { canRead: true, canWrite: true, canCreate: true, canStart: true, canComplete: true, isOwner: true, isMember: false, memberRole: 'owner' },
  summary: selected === 's5' ? { totalTasks: 0, completedTasks: 0, blockedTasks: 0, linkedFileCount: 0, totalStoryPoints: 0, completedStoryPoints: 0, completionPercentage: 0 }
    : { totalTasks: 5, completedTasks: 1, blockedTasks: 1, linkedFileCount: 0, totalStoryPoints: 26, completedStoryPoints: 5, completionPercentage: 20 },
  rows: selected === 's5' ? [] : [{ id: 'k', kind: 'kickoff', occurredAt: day(-3), sprint: sprints[1] },
    t('t1', 'Search API with tag filter', 'in_progress', 5, person('u1', 'Ravi Kumar')), t('t2', 'Search box on the top bar', 'in_progress', 3, person('u2', 'Asha Nair')),
    t('t3', 'Index rebuild job', 'blocked', 8, person('u1', 'Ravi Kumar')), t('t4', 'Empty results page', 'todo', 5, null), t('t5', 'Search spec', 'done', 5, person('u2', 'Asha Nair')),
    t('t6', 'Old idea', 'todo', 2, null, { membershipState: 'historical' })],
  nextCursor: null, hasMore: false, org: null, materials: [],
  people: [{ id: 'u1', name: 'Ravi Kumar', avatarUrl: null, openTasks: 2, openPoints: 13 }, { id: 'u2', name: 'Asha Nair', avatarUrl: null, openTasks: 1, openPoints: 3 }],
  unassigned: { tasks: 1, points: 5 }, velocity: { last: 21, average: 23 },
} });`;

test.beforeAll(async () => {
  const mocks: Record<string, string> = {
    'next/link': `import React from 'react';export default ({href,children,prefetch,...p})=>React.createElement('a',{href,...p},children);`,
    '@/hooks/use-auth': `export const useAuth=()=>({user:{id:'u1'}});`,
    'next/dynamic': `import React from 'react';export default (load)=>{const C=React.lazy(()=>load().then((m)=>({default:m.default??m})));return (p)=>React.createElement(React.Suspense,{fallback:null},React.createElement(C,p));};`,
    '@/hooks/workspaces/useWorkspaceTasksData': detail,
    '@/app/actions/workspace': `export const readSprintBacklogAction=async({query})=>({success:true,rows:[{id:'b1',title:'Refund flow',storyPoints:5,assignee:null,status:'todo',kind:'task'},{id:'b2',title:'Invoice PDF',storyPoints:3,assignee:'Asha Nair',status:'todo',kind:'task'},{id:'b3',title:'Retry payouts',storyPoints:null,assignee:null,status:'todo',kind:'task'}].filter((r)=>r.title.toLowerCase().includes(query.toLowerCase()))});
      export const createSprintAction=async(input)=>{(window.created??=[]).push(input);return {success:true,sprint:{id:'s9',code:'SPR-9'}}};`,
    '@/app/actions/task': `export const addTasksToSprintAction=async(input)=>{(window.added??=[]).push(input);return {added:input.taskIds.length,failed:[]}};`,
  };
  for (const [spec, source] of [['@/hooks/workspaces/useWorkspaceTasksData', 'src/hooks/workspaces/useWorkspaceTasksData.ts'], ['@/app/actions/workspace', 'src/app/actions/workspace/index.ts'], ['@/app/actions/task', 'src/app/actions/task.ts']] as const) {
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
  await expect(page.getByRole('heading', { name: /Sprint [45]/ })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Add work' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close sprint' })).toHaveCount(0);
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

test('§8.6: Add work plans from the backlog against what the team usually finishes', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add work' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add work to Sprint 4 · Search' });
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(600);
  await expect(dialog).toContainText('26 points');
  await expect(dialog).toContainText('Last sprint finished 21. Recent average 23.');
  await expect(dialog).toContainText('More than you usually finish.');
  await dialog.getByRole('checkbox', { name: /Refund flow/ }).check();
  await dialog.getByRole('checkbox', { name: /Retry payouts/ }).check();
  await expect(dialog).toContainText('31 points');
  await expect(dialog).toContainText('1 task has no points.');
  await dialog.getByRole('textbox', { name: 'Search the backlog' }).fill('invoice');
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await dialog.getByRole('textbox', { name: 'Search the backlog' }).fill('');
  await dialog.getByRole('button', { name: 'Add 2 tasks' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { added: unknown[] }).added)).toEqual([{ projectId: 'w1', sprintId: 's4', taskIds: ['b1', 'b3'] }]);
});

test('§6: New sprint offers one or several, folds notes, shows where it lands and names what it creates', async ({ page }) => {
  await open(page);
  await page.getByRole('complementary', { name: 'Sprints' }).getByRole('button', { name: 'New sprint' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('tab', { name: 'One sprint' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('textbox', { name: 'Notes' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '+ Add notes' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Notes' })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Sprint 7');
  await dialog.getByLabel('Starts').fill(new Date(Date.now() + 37 * 864e5).toISOString().slice(0, 10));
  await dialog.getByRole('button', { name: '2 weeks' }).click();
  await expect(dialog.getByRole('button', { name: '2 weeks' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByTestId('term-strip')).toContainText('Starts right after Sprint 6. No overlap.');
  await expect(dialog.getByTestId('sprint-options-summary')).toContainText('Starts by itself on');
  await expect(dialog.getByRole('button', { name: 'Create Sprint 7' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('sprint-form.png') });
  await dialog.getByLabel('Starts').fill(new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  await expect(dialog.getByTestId('term-strip')).toContainText('Overlaps Sprint 6.');
  await dialog.getByRole('tab', { name: 'Several (plan the term)' }).click();
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
  await page.getByRole('button', { name: 'Close sprint' }).click();
  const dialog = page.getByRole('dialog', { name: 'Close Sprint 4 · Search?' });
  await expect(dialog).toContainText('5 of 26 points done');
  await expect(dialog).toContainText('4 tasks still open go to');
  await expect(dialog.getByRole('radio', { name: /Sprint 5 · Payments/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'The backlog' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Stay here, for the record' })).toBeVisible();
});

test('§4: an upcoming sprint offers Add work and Start now; phones get the picker and no side scroll', async ({ page }) => {
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
