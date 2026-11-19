import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { serverActionsPlugin } from './server-actions-plugin';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';

// The shared workspace and organization header, against the real components and stylesheet.
const origin = 'https://workspace-header.test';
let script: string, css: string;

test.beforeAll(async () => {
    const mocks: Record<string, string> = {
        'next/link': `import React from 'react';export default ({href,children,prefetch,...p})=>React.createElement('a',{href,...p},children);`,
        'next/image': `import React from 'react';export default ({priority,fill,unoptimized,...p})=>React.createElement('img',p);`,
        'next/navigation': `export const useRouter=()=>({refresh(){},push(){}}),usePathname=()=>'/',useSearchParams=()=>new URLSearchParams();`,
        '@/app/actions/workspace/last-update': `export const getWorkspaceLastUpdates=async({projectIds})=>{await new Promise(r=>setTimeout(r,150));return projectIds.map(projectId=>({projectId,at:new Date(Date.now()-5*864e5).toISOString(),byName:'Ramanayudu Chandrasekhar Venkata Subramanian Naidu'}));};`,
        '@/components/workspaces/dashboard/WorkspaceSocialLinksCard': `export const WorkspaceLinkCluster=()=>null;`,
    };
    const bundle = await build({ entryPoints: [path.resolve('tests/browser/workspace-header.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'workspace-header-boundaries', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }, serverActionsPlugin] });
    script = bundle.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, view: string, width = 1200) {
    await page.setViewportSize({ width, height: 700 });
    await page.route(origin + '/**', route => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?view=${view}`);
    await page.getByTestId('workspace-last-update').waitFor();
}
const box = async (_page: Page, locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!;

test('Left is identity; right is buttons, then the updated line, then details', async ({ page }) => {
    await open(page, 'org');
    const title = await box(page, page.locator('h1'));
    const tagline = await box(page, page.getByText('Data Structures for 3rd-semester'));
    const people = await box(page, page.getByRole('button', { name: '40 members' }));
    const share = await box(page, page.getByRole('button', { name: /^Share (workspace|organization)$/ }));
    const updated = await box(page, page.getByTestId('workspace-last-update'));
    const details = await box(page, page.getByTestId('org-header-details'));

    expect(tagline.y).toBeGreaterThan(title.y);
    expect(people.y).toBeGreaterThan(tagline.y);
    expect(updated.y).toBeGreaterThanOrEqual(share.y + share.height);
    expect(details.y).toBeGreaterThanOrEqual(updated.y + updated.height);
    // Both right-aligned under the buttons, clear of the title.
    expect(Math.abs(updated.x + updated.width - (share.x + share.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(details.x + details.width - (share.x + share.width))).toBeLessThanOrEqual(1);
    expect(details.width).toBeLessThanOrEqual(280);
    expect(details.x).toBeGreaterThanOrEqual(title.x + 1);
    await expect(page.getByTestId('org-header-details')).toContainText('Part of Northgate Institute of Technology and Advanced Research · Bengaluru · Education');
    await expect(page.getByText('· 3 workspaces')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('org.png'), clip: { x: 0, y: 0, width: 1200, height: 260 } });
});

test('A long name cuts off and the exact time is on hover', async ({ page }) => {
    await open(page, 'image');
    const line = page.getByTestId('workspace-last-update');
    await expect(line).toHaveAttribute('title', /\d{4}/);
    const overflow = await line.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflow).toBe(true);
    expect((await box(page, line)).width).toBeLessThanOrEqual(280);
    await page.screenshot({ path: test.info().outputPath('image.png'), clip: { x: 0, y: 0, width: 1200, height: 260 } });
});

test('The side column keeps its height before the updated line loads', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 700 });
    await page.route(origin + '/**', route => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?view=image`);
    const side = page.getByTestId('workspace-header-side');
    await side.waitFor();
    await expect(page.getByTestId('workspace-last-update')).toHaveCount(0);
    const before = await box(page, side);
    await page.getByTestId('workspace-last-update').waitFor();
    expect((await box(page, side)).height).toBe(before.height);
});

test('The icon slot holds its place: image, add for the owner, the default pixel avatar for a visitor', async ({ page }) => {
    await open(page, 'image');
    const image = await box(page, page.getByTestId('project-avatar'));
    const name = await box(page, page.locator('h1'));
    await expect(page.getByTestId('project-avatar').locator('img')).toHaveCount(1);

    await open(page, 'empty');
    expect(await box(page, page.getByTestId('project-avatar'))).toEqual(image);
    expect((await box(page, page.locator('h1'))).x).toBe(name.x);
    await expect(page.getByRole('link', { name: 'Add workspace avatar' })).toHaveAttribute('href', /tab=settings#project-settings-general/);
    await expect(page.getByText('Add image')).toHaveCount(0);

    await open(page, 'visitor');
    // Shell redesign: no picture shows the workspace's default pixel figure (a desk), never initials.
    await expect(page.getByTestId('project-avatar').locator('[data-slot="pixel-place"]')).toHaveCount(1);
    await expect(page.getByTestId('project-avatar')).toHaveText('');
    await expect(page.getByRole('link', { name: 'Add workspace avatar' })).toHaveCount(0);
    expect((await box(page, page.locator('h1'))).x).toBe(name.x);
});

test('The people row starts under the image, with no space left below the image', async ({ page }) => {
    await open(page, 'image');
    const image = await box(page, page.getByTestId('project-avatar'));
    const team = await box(page, page.getByLabel(/workspace team/));
    const tagline = await box(page, page.getByText('See Beyond the Surface'));
    expect(image.height).toBe(64);
    expect(Math.abs(team.x - image.x)).toBeLessThanOrEqual(2);
    expect(team.y).toBeGreaterThanOrEqual(image.y + image.height);
    expect(team.y - (image.y + image.height)).toBeLessThanOrEqual(14);
    // The image and the name with tagline read as one block.
    expect(Math.abs(tagline.y + tagline.height - (image.y + image.height))).toBeLessThanOrEqual(4);
});

test('On a phone the tagline runs full width under the image, so a wrapped tagline leaves no space beside it', async ({ page }) => {
    await open(page, 'org', 375);
    const image = await box(page, page.getByTestId('project-avatar'));
    const name = await box(page, page.locator('h1'));
    const tagline = await box(page, page.getByText('Data Structures for 3rd-semester'));
    const people = await box(page, page.getByRole('button', { name: '40 members' }));
    expect(image.height).toBe(48);
    expect(name.x).toBeGreaterThan(image.x + image.width);
    expect(Math.abs(tagline.x - image.x)).toBeLessThanOrEqual(1);
    expect(tagline.y).toBeGreaterThanOrEqual(Math.max(image.y + image.height, name.y + name.height));
    expect(people.y).toBeGreaterThan(tagline.y);
});

test('Details take one line on a wide screen and wrap at 280px below that', async ({ page }) => {
    await open(page, 'org', 1440);
    const wide = await box(page, page.getByTestId('org-header-details'));
    expect(wide.width).toBeGreaterThan(280);
    expect(wide.width).toBeLessThanOrEqual(420);
    await page.screenshot({ path: test.info().outputPath('wide.png'), clip: { x: 0, y: 0, width: 1440, height: 240 } });
});

test('The name and the buttons share the top line', async ({ page }) => {
    await open(page, 'image');
    const name = await box(page, page.locator('h1'));
    const share = await box(page, page.getByRole('button', { name: /^Share (workspace|organization)$/ }));
    expect(Math.abs(name.y + name.height / 2 - (share.y + share.height / 2))).toBeLessThanOrEqual(4);
});

test('On a phone it stacks left-aligned, with nothing pushing the page sideways', async ({ page }) => {
    await open(page, 'org', 375);
    const name = await box(page, page.locator('h1'));
    const people = await box(page, page.getByRole('button', { name: '40 members' }));
    const share = await box(page, page.getByRole('button', { name: /^Share (workspace|organization)$/ }));
    const updated = await box(page, page.getByTestId('workspace-last-update'));
    const details = await box(page, page.getByTestId('org-header-details'));
    expect(share.y).toBeGreaterThan(people.y);
    expect(updated.y).toBeGreaterThan(share.y);
    expect(details.y).toBeGreaterThan(updated.y);
    expect(Math.abs(updated.x - details.x)).toBeLessThanOrEqual(1);
    expect(updated.x).toBeLessThan(name.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath('phone.png') });
});
