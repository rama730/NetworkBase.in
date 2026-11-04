import { serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from './axe';

// Left navigation → Workspaces (docs/superpowers/plans/2026-11-05-sidebar-workspaces-findings.md), against the real
// component and stylesheet: names only, an organization's group, the current row, dots, pins, filter, ⋯, collapsed.
const origin = 'https://org-sidebar.test';
let script: string, css: string;

test.beforeAll(async () => {
    const mocks: Record<string, string> = {
        'next/link': `import React from 'react';export default ({href,children,prefetch,...p})=>React.createElement('a',{href,...p},children);`,
        'next/navigation': `export const usePathname=()=>new URLSearchParams(location.search).get('path')||'/org/cse-3b';export const useRouter=()=>({push(){},replace(){},refresh(){}});`,
        '@/app/actions/org-workspace': `export const setSidebarPinAction=async(id,pinned)=>{(window.calls=window.calls||[]).push([id,pinned]);return {success:true};};`,
    };
    const bundle = await build({ entryPoints: [path.resolve('tests/browser/org-sidebar.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'org-sidebar-boundaries', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }, serverActionsPlugin] });
    script = bundle.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, query = '', width = 300) {
    await page.setViewportSize({ width, height: 1000 });
    await page.route(origin + '/**', route => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html lang="en"><head><title>Sidebar</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?${query}`);
    await page.getByTestId('sidebar-workspaces').waitFor({ state: 'attached' });
}
const list = (page: Page) => page.getByTestId('sidebar-workspaces');

test('§1: names only — no pictures or letters on any row; long names end in … with the full name on hover', async ({ page }) => {
    await open(page);
    await expect(list(page).locator('img')).toHaveCount(0);
    for (const letters of ['CS', 'PO', 'CA', 'QU']) await expect(list(page).getByText(letters, { exact: true })).toHaveCount(0);
    const falcon = list(page).getByRole('link', { name: /Team Falcon/ });
    await expect(falcon).toHaveAttribute('title', 'Team Falcon: Hash table library');
    expect(await falcon.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');
    await expect(list(page).getByRole('link', { name: 'CSE 3A / Parser Lab' })).toBeVisible();
    await expect(list(page).getByRole('link', { name: /Robotics Club/ })).toContainText('Requested');
});

test('§2: the group — chevron at the left, the count says what it counts, + only on hover or focus, workspaces one step in under a line', async ({ page }) => {
    await open(page);
    const row = page.locator('[data-org-row]').first();
    const chevron = row.getByRole('button', { name: 'Hide CSE 3B · Data Structures 2026’s workspaces' });
    const name = row.getByRole('link', { name: /^CSE 3B · Data Structures 2026, 2 things need you/ });
    expect((await chevron.boundingBox())!.x).toBeLessThan((await name.boundingBox())!.x);
    await expect(row.locator('.nb-nav-count')).toHaveAttribute('title', '2 things need you');
    const plus = row.getByRole('link', { name: 'New workspace in CSE 3B · Data Structures 2026' });
    await expect(plus).toBeHidden();
    const rest = await name.boundingBox();
    const count = await row.locator('.nb-nav-count').boundingBox();
    await row.hover();
    await expect(plus).toBeVisible();
    // No "jelly" (the user, 5 Nov): + and ⋯ float over the row's end; the name and the count don't move or resize.
    expect(await name.boundingBox()).toEqual(rest);
    expect(await row.locator('.nb-nav-count').boundingBox()).toEqual(count);
    const kids = page.getByRole('list', { name: 'Workspaces in CSE 3B · Data Structures 2026' });
    expect(await kids.evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe('1px');
    expect((await kids.boundingBox())!.x).toBeGreaterThan((await row.boundingBox())!.x + 10);
    const fontOf = (l: ReturnType<Page['locator']>) => l.evaluate((el) => getComputedStyle(el.closest('.nb-nav-link')!).fontSize);
    expect(await fontOf(kids.getByRole('link', { name: /Team Osprey/ }))).toBe(await fontOf(list(page).getByRole('link', { name: 'Ponytail' })));
    await expect(kids.getByRole('listitem')).toHaveCount(6, { timeout: 2000 });
    await expect(kids.getByRole('link', { name: 'All workspaces · 2 more' })).toHaveAttribute('href', '/org/cse-3b?tab=projects');
    await chevron.click();
    await expect(kids).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('list', { name: 'Workspaces in CSE 3B · Data Structures 2026' })).toHaveCount(0, { timeout: 3000 });
    await expect(page.locator('[data-org-row]').first().getByRole('button', { name: /Show CSE 3B/ })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('list', { name: 'Workspaces in Quiet Org' }).getByRole('link', { name: 'All workspaces' })).toBeVisible();
});

test('G2: the workspace you\'re on shows and its group opens, even past the first five and when remembered closed', async ({ page }) => {
    await open(page, 'path=/workspaces/owl');
    await page.evaluate(() => localStorage.setItem('nb:sidebar-org:org', 'closed'));
    await page.reload();
    const kids = page.getByRole('list', { name: 'Workspaces in CSE 3B · Data Structures 2026' });
    await expect(kids.getByRole('link', { name: 'Team Owl' })).toHaveAttribute('aria-current', 'page');
    await expect(kids.getByRole('link', { name: 'All workspaces · 1 more' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('nb:sidebar-org:org'))).toBe('closed');
});

test('G5: a dot for unseen updates; G9: ⋯ pins to the top, copies the link, opens a new tab', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await open(page);
    await expect(list(page).getByRole('link', { name: 'Caveman, new updates' })).toBeVisible();
    await expect(list(page).getByRole('link', { name: 'Team Falcon: Hash table library, new updates' })).toBeVisible();
    await list(page).getByRole('link', { name: 'Caveman, new updates' }).hover();
    await list(page).getByRole('button', { name: 'More for Caveman' }).click();
    await expect(page.getByRole('menuitem', { name: 'Open in new tab' })).toHaveAttribute('href', '/workspaces/p1');
    await expect(page.getByRole('menuitem', { name: 'Open in new tab' })).toHaveAttribute('target', '_blank');
    await page.getByRole('menuitem', { name: 'Pin to top' }).click();
    expect(await page.evaluate(() => (window as unknown as { calls: unknown[] }).calls)).toEqual([['p1', true]]);
    const items = list(page).getByRole('list', { name: 'Your workspaces' }).locator(':scope > li');
    await expect(items.first()).toHaveText('Pinned');
    await expect(items.nth(1)).toContainText('Caveman');
    await open(page, 'pinned=1');
    await list(page).getByRole('link', { name: 'Caveman, new updates' }).first().hover();
    await list(page).getByRole('button', { name: 'More for Caveman' }).first().click();
    await page.getByRole('menuitem', { name: 'Copy link' }).click();
    await expect(page.getByText('Link copied').first()).toBeVisible();
});

test('G3, G8, G11: More past 12, a filter past 10 rows (Esc clears), Archived remembered', async ({ page }) => {
    await open(page, 'size=long');
    await expect(list(page).getByRole('button', { name: 'More (3)' })).toBeVisible();
    const filter = page.getByLabel('Filter workspaces');
    await filter.fill('owl');
    await expect(list(page).getByRole('link', { name: 'Team Owl' })).toBeVisible();
    await expect(list(page).getByRole('link', { name: 'Ponytail' })).toHaveCount(0);
    await filter.fill('zzz');
    await expect(page.getByText('No workspaces match')).toBeVisible();
    await filter.press('Escape');
    await expect(filter).toHaveValue('');
    await page.getByRole('button', { name: 'Archived (1)' }).click();
    await page.reload();
    await expect(page.getByRole('list', { name: 'Archived workspaces' })).toBeVisible();
    await open(page, 'size=small');
    await expect(list(page).getByRole('link', { name: 'Ponytail' })).toBeVisible();
    await expect(page.getByLabel('Filter workspaces')).toHaveCount(0);
});

test('G6: space between the organizations and your own; G10: nested lists; keyboard reaches chevron, +, ⋯', async ({ page }) => {
    await open(page);
    const quiet = await page.locator('[data-org-row]').nth(1).boundingBox();
    const robotics = await list(page).getByRole('link', { name: /Robotics Club/ }).boundingBox();
    const quietKids = await page.getByRole('list', { name: 'Workspaces in Quiet Org' }).boundingBox();
    expect(robotics!.y - (quietKids!.y + quietKids!.height)).toBeGreaterThanOrEqual(8);
    expect(quiet).toBeTruthy();
    await page.getByRole('button', { name: 'Hide CSE 3B · Data Structures 2026’s workspaces' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /^CSE 3B · Data Structures 2026, 2 things need you/ })).toBeFocused();
    await page.keyboard.press('Tab');
    const plus = page.getByRole('link', { name: 'New workspace in CSE 3B · Data Structures 2026' });
    await expect(plus).toBeFocused();
    await expect(plus).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('sidebar-300.png'), fullPage: true });
});

test('D1, G7: the collapsed strip hides the list and shows the Workspaces button; the open sidebar shows the list, not the button', async ({ page }) => {
    await open(page, 'view=collapsed');
    await expect(page.getByRole('button', { name: 'Workspaces', exact: true })).toBeVisible();
    // Its icon lines up with the strip's other icons (the user, 5 Nov): same box width, same icon centre.
    const centre = async (l: ReturnType<Page['locator']>) => { const b = (await l.boundingBox())!; return Math.round(b.x + b.width / 2); };
    const discover = page.getByRole('link', { name: 'Discover' });
    const rail = page.getByRole('button', { name: 'Workspaces', exact: true });
    expect((await rail.boundingBox())!.width).toBe((await discover.boundingBox())!.width);
    expect(await centre(rail.locator('svg'))).toBe(await centre(discover.locator('svg')));
    await expect(list(page)).toBeHidden();
    await open(page);
    await expect(page.getByRole('button', { name: 'Workspaces', exact: true })).toBeHidden();
    await expect(list(page)).toBeVisible();
});

test('no jelly: a row never paints a box inside itself, hovering a workspace moves nothing, and the page you\'re on has no dot', async ({ page }) => {
    await open(page, 'path=/workspaces/p1');
    const caveman = list(page).getByRole('link', { name: 'Caveman' });
    await expect(list(page).getByRole('link', { name: 'Caveman, new updates' })).toHaveCount(0, { timeout: 2000 });
    await expect(caveman).toHaveAttribute('aria-current', 'page');
    const falcon = list(page).getByRole('link', { name: 'Team Falcon: Hash table library, new updates' });
    const rest = await falcon.boundingBox();
    const dot = await falcon.locator('xpath=..').getByTestId('unseen-dot').boundingBox();
    await falcon.hover();
    await expect(list(page).getByRole('button', { name: 'More for Team Falcon: Hash table library' })).toBeVisible();
    expect(await falcon.boundingBox()).toEqual(rest);
    expect(await falcon.locator('xpath=..').getByTestId('unseen-dot').boundingBox()).toEqual(dot);
    // Keyboard focus: from Ponytail, Tab reaches its ⋯ (it shows while the row has focus), then Caveman.
    await list(page).getByRole('link', { name: 'Ponytail' }).focus();
    await page.keyboard.press('Tab');
    await expect(list(page).getByRole('button', { name: 'More for Ponytail' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(caveman).toBeFocused();
    expect(await caveman.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const rowBg = await caveman.evaluate((el) => getComputedStyle(el.closest('[data-ws-row]')!).backgroundColor);
    expect(rowBg).not.toBe('rgba(0, 0, 0, 0)');
});
