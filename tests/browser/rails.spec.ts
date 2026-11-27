import { serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';

const origin = 'https://rails.test';
let script: string;
let css: string;
let sans: Buffer;
let mono: Buffer;
test.use({ reducedMotion: 'reduce' });
test.beforeAll(async () => {
  const mocks: Record<string, string> = {
    '@/components/presence/usePresence': `export const usePersonPresence=()=>({loaded:true,availability:'now',label:'Active now'});export const useWorkspacePresence=()=>({availability:'offline',label:'Offline'});export const useNow=()=>Date.now();`,
    '@/app/actions/connections': `export const readPersonSharedConnectionsAction=async()=>({success:false,error:'Unavailable in this rail-only fixture'});`,
    'next/link': `import React from 'react';export default ({href,children,...props})=>React.createElement('a',{href,...props},children);`,
    'next/image': `import React from 'react';export default ({priority,fill,unoptimized,...props})=>React.createElement('img',props);`,
    'next/dynamic': `import React from 'react';export default (load,options)=>{const C=React.lazy(load);return props=>React.createElement(React.Suspense,{fallback:options.loading?React.createElement(options.loading):null},React.createElement(C,props));};`,
    'next/navigation': `import {useMemo,useSyncExternalStore} from 'react';const subscribe=fn=>{window.addEventListener('popstate',fn);return()=>window.removeEventListener('popstate',fn);};const navigate=(url,replace=false)=>{history[replace?'replaceState':'pushState']({},'',url);window.dispatchEvent(new PopStateEvent('popstate'));};const router={push:url=>navigate(url),replace:url=>navigate(url,true)};export const useRouter=()=>router;export const useSearchParams=()=>{const search=useSyncExternalStore(subscribe,()=>location.search);return useMemo(()=>new URLSearchParams(search),[search]);};export const usePathname=()=>location.pathname;`,
    '@/hooks/useNetworkNotifications': `export const useNetworkNotifications=()=>({pendingConnections:2,pendingInvites:1,pendingApplications:0,totalConnections:8,refresh:async()=>{}});`,
    '@/components/network/ConnectionsClient': `import React from 'react';export default ({onReady})=>{React.useEffect(()=>{onReady?.();},[onReady]);return React.createElement('p',{},'Your connected people');};`,
    '@/components/network/InvitationsClient': `import React from 'react';export default ({onReady})=>{React.useEffect(()=>{onReady?.();},[onReady]);return React.createElement('p',{},'Your pending invitations');};`,
    '@/app/actions/workspace/recent-activity': `export const readWorkspaceRecentActivityAction=()=>window.railsFixture.readActivity();`,
    '@/hooks/useConnections': `import {useSyncExternalStore} from 'react';const subscribe=fn=>{window.addEventListener('people-ready',fn);return()=>window.removeEventListener('people-ready',fn);};export const useSuggestedPeople=(limit,search,filters)=>{window.railsFixture.lastPeopleQuery={search,filters};const params=new URLSearchParams(location.search);const pending=useSyncExternalStore(subscribe,()=>params.has('initial-loading')&&!window.railsFixture.peopleReady,()=>false);if(params.has('render-error')&&!window.railsFixture.renderRecovered)throw new Error('Fixture render failed');if(pending)return {isLoading:true,isError:false};if(params.has('initial-error'))return {isLoading:false,isError:true};const total=Number(params.get('shared')||0);const items=Array.from({length:params.has('empty')?0:params.has('more')?7:1},(_,i)=>({id:'person-'+(i+1),username:'suggestion'+(i+1),fullName:'Suggestion '+(i+1),connectionStatus:'none',canConnect:!(params.has('unavailable')&&i>=3),...(params.get('surface')==='network-layout'&&i===0?{headline:'Engineer specializing in interfaces.',location:'Lisbon',skills:['React','TypeScript'],mutualConnections:6}:{})}));return {data:{pages:[{items,viewerSkills:[],sharedConnections:params.has('summary-error')?undefined:{targetIds:params.has('stale')?['old-person']:items.slice(0,3).map(p=>p.id),total,people:Array.from({length:Math.min(total,4)},(_,i)=>({id:'peer-'+i,username:'peer'+i,fullName:'Connection '+i,avatarUrl:null}))}}]},isLoading:false,isError:params.has('page-error'),hasNextPage:params.has('page-error'),isFetchNextPageError:params.has('page-error'),isFetchingNextPage:false,fetchNextPage:async()=>{window.railsFixture.events.push('retry-page');},refetch:()=>{}};};export const useConnectionMutations=()=>({sendRequest:{isPending:false,mutateAsync:async({userId})=>{window.railsFixture.events.push('connect:'+userId);return {status:'pending'};}}});export const getConnectionRequestSuccessMessage=()=>'';`,
    '@/components/network/PersonCard': `import React from 'react';export {PersonCardLayout,PersonCardGrid} from ${JSON.stringify(path.resolve('src/components/network/PersonCard.tsx'))};export default ({profile})=>React.createElement('div',{className:'rounded-lg border border-border bg-card p-4'},'Suggested person '+profile.id);`,
    '@/components/messages/message-user': `export const messageUserInWindow=()=>false;`,
    '@/components/network/PersonPresenceDot': `export const PersonPresenceDot=()=>null;export const PersonPresenceText=()=>null;`,
    '@/app/actions/connections': `export const readPersonSharedConnectionsAction=async()=>({success:true,total:0,people:[]});`,
    '@/app/actions/org-workspace': `export const readSharedOrgsAction=async()=>[];`,
  };
  const bundle = await build({ entryPoints: [path.resolve('tests/browser/rails.fixture.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'isolated-rails', setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if (args.path === '@/components/network/PersonCard' && args.importer.endsWith('/NetworkPeopleTab.tsx')) return { path: path.resolve('src/components/network/PersonCard.tsx') };
      return args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined;
    });
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
  } }, serverActionsPlugin] });
  script = bundle.outputFiles![0]!.text;
  const result = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  [sans, mono] = await Promise.all([readFile('src/app/fonts/InstrumentSans.woff2'), readFile('src/app/fonts/JetBrainsMono.woff2')]);
  css = `@font-face{font-family:'Instrument Sans';src:url('/sans.ttf');font-weight:400 700;}@font-face{font-family:'JetBrains Mono';src:url('/mono.ttf');font-weight:100 800;}:root{--font-instrument-sans:'Instrument Sans';--font-jetbrains-mono:'JetBrains Mono';}` + result.css;
});
test.beforeEach(async ({ page }) => {
  await page.route(origin + '/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/skill-catalog.json') return route.fulfill({ body: await readFile('public/skill-catalog.json'), contentType: 'application/json' });
    if (/^\/skill-icons\/v1\/[a-zA-Z0-9._-]+\.(svg|png)$/.test(pathname)) return route.fulfill({ body: await readFile(path.join('public', pathname)), contentType: pathname.endsWith('.svg') ? 'image/svg+xml' : 'image/png' });
    if (pathname === '/sans.ttf' || pathname === '/mono.ttf') return route.fulfill({ contentType: 'font/ttf', body: pathname === '/sans.ttf' ? sans : mono });
    return route.fulfill({ contentType: pathname === '/app.js' ? 'application/javascript' : pathname === '/app.css' ? 'text/css' : 'text/html', body: pathname === '/app.js' ? script : pathname === '/app.css' ? css : '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>' });
  });
});
async function open(page: Page, query: string) {
  await page.goto(origin + '/?' + query);
  await expect(page.getByRole('heading').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
/** The profile's right card (mix): one card, each section a mono label heading over its content. */
async function checkCardSection(page: Page, name: string) {
  const heading = page.getByRole('heading', { name, exact: true });
  await expect(heading).toHaveCount(1);
  await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
  expect(await heading.evaluate(el => { const s = getComputedStyle(el); return [s.fontSize, s.fontWeight, s.textTransform]; })).toEqual(['11px', '500', 'uppercase']);
  expect(await heading.evaluate(el => el.closest('.nb-pf-facts') !== null)).toBe(true);
}
async function checkHeading(page: Page, name: string) {
  const heading = page.getByRole('heading', { name, exact: true });
  await expect(heading).toHaveCount(1);
  const section = page.getByRole('region', { name, exact: true });
  const headingRow = heading.locator('..');
  const body = headingRow.locator('xpath=following-sibling::div[1]');
  const divider = headingRow.locator(':scope > div[aria-hidden="true"]');
  const h = (await heading.boundingBox())!;
  const b = (await body.boundingBox())!;
  const d = (await divider.boundingBox())!;
  expect(h.y + h.height).toBeLessThan(b.y);
  expect(d.x).toBeGreaterThanOrEqual(h.x + h.width);
  expect(d.width).toBeGreaterThan(0);
  expect(d.height).toBe(1);
  expect(await heading.evaluate(el => { const s = getComputedStyle(el); return [s.fontSize, s.fontWeight, s.textTransform, s.fontFamily]; })).toEqual(['11px', '500', 'uppercase', '"JetBrains Mono", monospace']);
  expect(await body.evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('1px');
  await expect(body.getByRole('heading', { level: 2 })).toHaveCount(0);
  await expect(section).toBeVisible();
}

test('Discover tall rail scrolls with the feed, pins at the bottom, and adapts to content and viewport resizing', async ({ page }) => {
  await open(page, 'surface=sticky-rail');
  const root = page.getByTestId('discover-feed-scroll');
  const rail = page.getByRole('complementary', { name: 'People and profile' });
  const marker = page.getByTestId('feed-marker');
  const initial = (await rail.boundingBox())!;
  const initialMarker = (await marker.boundingBox())!;
  await root.evaluate(el => el.scrollTo({ top: 100 }));
  await expect.poll(async () => (await rail.boundingBox())!.y).toBeCloseTo(initial.y - 100, 0);
  expect((await marker.boundingBox())!.y).toBeCloseTo(initialMarker.y - 100, 0);

  const expectedBottom = async () => (await root.boundingBox())!.y + await root.evaluate(el => el.clientHeight) - 24;
  const railBottom = async () => { const r = (await rail.boundingBox())!; return r.y + r.height; };
  await root.evaluate(el => el.scrollTo({ top: 600 }));
  await expect.poll(railBottom).toBeCloseTo(await expectedBottom(), 0);
  const pinnedMarker = (await marker.boundingBox())!;
  await root.evaluate(el => el.scrollTo({ top: 1000 }));
  await expect.poll(railBottom).toBeCloseTo(await expectedBottom(), 0);
  expect((await marker.boundingBox())!.y).toBeCloseTo(pinnedMarker.y - 400, 0);
  expect(await root.evaluate(el => getComputedStyle(el).overflowY)).toBe('auto');
  expect(await rail.evaluate(el => getComputedStyle(el).overflowY)).toBe('visible');

  await page.setViewportSize({ width: 1200, height: 700 });
  await expect.poll(railBottom).toBeCloseTo(await expectedBottom(), 0);
  await rail.getByRole('button', { name: 'Expand rail content' }).click();
  await expect.poll(async () => (await rail.boundingBox())!.height).toBe(1400);
  await expect.poll(railBottom).toBeCloseTo(await expectedBottom(), 0);

  await root.evaluate(el => el.scrollTo({ top: 100 }));
  await expect.poll(async () => (await rail.boundingBox())!.y).toBeCloseTo(initial.y - 100, 0);
  await root.evaluate(el => el.scrollTo({ top: 0 }));
  await expect.poll(async () => (await rail.boundingBox())!.y).toBeCloseTo(initial.y, 0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});

test('Discover short rail stays accessible at the top and the desktop rail hides below its breakpoint', async ({ page }) => {
  await open(page, 'surface=sticky-rail&short');
  const rail = page.getByRole('complementary', { name: 'People and profile' });
  const initial = (await rail.boundingBox())!;
  await page.getByTestId('discover-feed-scroll').evaluate(el => el.scrollTo({ top: 800 }));
  await expect.poll(async () => (await rail.boundingBox())!.y).toBeCloseTo(initial.y, 0);
  await expect(rail.getByRole('link', { name: 'Rail bottom' })).toBeVisible();
  await page.setViewportSize({ width: 1199, height: 900 });
  await expect(rail).not.toBeVisible();
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(rail).toBeVisible();
  await expect.poll(async () => (await rail.boundingBox())!.y).toBeCloseTo(initial.y, 0);
});

for (const surface of ['profile', 'project']) {
  const label = surface === 'profile' ? 'Profile details' : 'Workspace details';
  test(`${surface} tall rail scrolls naturally and pins its bottom while the main content continues`, async ({ page }) => {
    await open(page, `surface=sticky-${surface}`);
    const root = page.getByTestId('detail-page-scroll');
    const rail = page.getByRole('complementary', { name: label });
    const main = surface === 'profile' ? page.getByTestId('detail-main') : page.getByRole('heading', { name: 'About this workspace' });
    const initial = (await rail.boundingBox())!;
    await root.evaluate(el => el.scrollTo({ top: 100 }));
    await expect.poll(async () => (await rail.boundingBox())!.y).toBeCloseTo(initial.y - 100, 0);
    const railBottom = async () => { const r = (await rail.boundingBox())!; return r.y + r.height; };
    const expectedBottom = async () => (await root.boundingBox())!.y + await root.evaluate(el => el.clientHeight) - 24;
    await root.evaluate(el => el.scrollTo({ top: 700 }));
    await expect.poll(railBottom).toBeCloseTo(await expectedBottom(), 0);
    const pinnedMain = (await main.boundingBox())!;
    await root.evaluate(el => el.scrollTo({ top: 1000 }));
    await expect.poll(railBottom).toBeCloseTo(await expectedBottom(), 0);
    expect((await main.boundingBox())!.y).toBeCloseTo(pinnedMain.y - 300, 0);
    await page.setViewportSize({ width: 1200, height: 700 });
    await expect.poll(railBottom).toBeCloseTo(await expectedBottom(), 0);
    if (surface === 'profile') {
      await page.getByTestId('detail-rail-content').evaluate(el => { el.style.height = '1400px'; });
    } else {
      await rail.evaluate(el => { el.style.minHeight = '1400px'; });
    }
    await expect.poll(async () => (await rail.boundingBox())!.height).toBe(1400);
    await expect.poll(railBottom).toBeCloseTo(await expectedBottom(), 0);
    expect(await rail.evaluate(el => getComputedStyle(el).overflowY)).toBe('visible');
    await root.evaluate(el => el.scrollTo({ top: 0 }));
    await expect.poll(async () => (await rail.boundingBox())!.y).toBeCloseTo(initial.y, 0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  });

  test(`${surface} short rail respects its top inset and returns to normal flow below desktop`, async ({ page }) => {
    await open(page, `surface=sticky-${surface}&short`);
    const root = page.getByTestId('detail-page-scroll');
    const rail = page.getByRole('complementary', { name: label });
    // The profile card clears the floating tab bar (8px gap + 44px bar + 16px): 68px. Projects keep 24px under their tabs.
    const expectedTop = (await root.boundingBox())!.y + (surface === 'project' ? 24 + 56 : 68);
    await root.evaluate(el => el.scrollTo({ top: 800 }));
    await expect.poll(async () => (await rail.boundingBox())!.y).toBeCloseTo(expectedTop, 0);
    if (surface === 'project') {
      // The existing layout updates this variable when its sticky tabs resize.
      await page.getByTestId('project-layout').evaluate(el => el.style.setProperty('--workspace-tabs-height', '72px'));
      await expect.poll(async () => (await rail.boundingBox())!.y).toBeCloseTo(expectedTop + 16, 0);
    }
    await page.setViewportSize({ width: 1023, height: 900 });
    expect(await rail.evaluate(el => getComputedStyle(el).position)).toBe('static');
    await page.setViewportSize({ width: 320, height: 740 });
    await root.evaluate(el => el.scrollTo({ top: el.scrollHeight }));
    const content = surface === 'profile' ? page.getByRole('link', { name: 'Edit preferences' }) : page.getByRole('heading', { name: 'Open roles', exact: true });
    await expect(content).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('Network person cards retain the approved size across sparse rows, loading and long accessible text', async ({ page }) => {
  for (const width of [1200, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, 'surface=network-cards');
    const cards = page.locator('[data-slot="person-card"]');
    await expect(cards).toHaveCount(5);
    for (const card of await cards.all()) {
      await card.scrollIntoViewIfNeeded();
      expect((await card.boundingBox())!.height).toBe(176);
    }
    const first = cards.first();
    await first.scrollIntoViewIfNeeded();
    const box = (await first.boundingBox())!;
    const avatar = (await first.locator('[data-slot=user-avatar]').boundingBox())!;
    const name = (await first.locator('.nb-person-name').boundingBox())!;
    const action = (await first.getByRole('button').boundingBox())!;
    expect(avatar.x - box.x).toBe(width < 430 ? 17 : 21);
    expect(avatar.y - box.y).toBe(width < 430 ? 17 : 21);
    expect(name.x - avatar.x - avatar.width).toBe(14);
    expect(action.x).toBeGreaterThan(name.x);
    expect(box.x + box.width - action.x - action.width).toBeCloseTo(width < 430 ? 17 : 21, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await open(page, 'surface=network-cards&long');
  const long = page.locator('[data-slot="person-card"]').nth(1);
  expect((await long.boundingBox())!.height).toBe(176);
  await expect(long.locator('.nb-person-subtitle a')).toHaveAttribute('title', /Long content/);
  expect(await long.evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
  await open(page, 'surface=network-cards&unscoped');
  expect((await page.locator('[data-slot="person-card"]').first().boundingBox())!.height).toBe(176);
});

test('the full Network page matches Discover geometry and sizes cards to its main column', async ({ page }) => {
  for (const width of [1440, 1200, 1199, 900, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, 'surface=discover-layout');
    const reference = page.getByRole('heading', { name: 'Discover', exact: true });
    const referenceBox = (await reference.boundingBox())!;
    const referenceFont = await reference.evaluate(el => { const s = getComputedStyle(el); return [s.fontSize, s.lineHeight, s.fontWeight]; });
    await open(page, 'surface=network-layout&more');
    const heading = page.getByRole('heading', { name: 'Network', exact: true });
    const box = (await heading.boundingBox())!;
    expect(box.x).toBeCloseTo(referenceBox.x, 0);
    expect(box.y).toBeCloseTo(referenceBox.y, 0);
    expect(await heading.evaluate(el => { const s = getComputedStyle(el); return [s.fontSize, s.lineHeight, s.fontWeight]; })).toEqual(referenceFont);
    const main = page.locator('.nb-network-main');
    const mainBox = (await main.boundingBox())!;
    const rail = page.getByRole('complementary', { name: 'Network overview', exact: true });
    if (width >= 1200) {
      await expect(rail).toBeVisible();
      const railBox = (await rail.boundingBox())!;
      expect(railBox.width).toBe(320);
      expect(railBox.x - mainBox.x - mainBox.width).toBeCloseTo(24, 0);
      await checkHeading(page, 'Your network');
    } else await expect(rail).not.toBeVisible();
    const cards = page.locator('[data-slot="person-card"]');
    await expect(cards).toHaveCount(7);
    const first = (await cards.nth(0).boundingBox())!;
    const second = (await cards.nth(1).boundingBox())!;
    if (mainBox.width >= 720) {
      expect(second.y).toBeCloseTo(first.y, 0);
      expect(first.width).toBeCloseTo((mainBox.width - 14) / 2, 0);
    } else {
      expect(second.y).toBeGreaterThan(first.y);
      expect(first.width).toBeCloseTo(mainBox.width, 0);
    }
    for (const card of await cards.all()) {
      await card.scrollIntoViewIfNeeded();
      expect((await card.boundingBox())!.height).toBeGreaterThanOrEqual(176);
    }
    await page.getByTestId('network-route-scroll').evaluate(el => el.scrollTo({ top: 0 }));
    const search = (await page.getByRole('searchbox', { name: 'Search people' }).boundingBox())!;
    expect(search.y).toBeGreaterThan(box.y + box.height);
    if (mainBox.width >= 800) {
      const tabs = (await page.getByRole('tablist', {name:'Network sections'}).boundingBox())!;
      expect(search.width).toBe(256);
      expect(search.x).toBeGreaterThanOrEqual(tabs.x + tabs.width);
      expect(search.y).toBeLessThan(tabs.y + tabs.height);
      expect(search.y + search.height).toBeGreaterThan(tabs.y);
    }
    const underline = await page.getByRole('tab', {name:/^Suggested\b/}).evaluate(tab => {
      const toolbar = tab.closest('[role=tablist]')!.parentElement!;
      return {gap:toolbar.getBoundingClientRect().bottom-tab.getBoundingClientRect().bottom, thickness:getComputedStyle(tab).borderBottomWidth};
    });
    expect(Math.abs(underline.gap), `underline gap at ${width}px`).toBeLessThanOrEqual(.5);
    expect(underline.thickness).toBe('2px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    if (width === 1440 || width === 320) await page.screenshot({ path: test.info().outputPath(`network-layout-${width}.png`) });
  }
});

test('Network toolbar and overview preserve search, tab navigation, connection actions and guest access', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, 'surface=network-layout&more');
  const search = page.getByRole('searchbox', { name: 'Search people' });
  await search.fill('React');
  await expect(search).toHaveValue('React');
  await expect(page).toHaveURL(/q=React/);
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set('q', 'Rust');
    history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(search).toHaveValue('Rust');
  await page.goBack();
  await expect(search).toHaveValue('React');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page).not.toHaveURL(/q=/);
  await page.getByRole('button', { name: 'Connect with Suggestion 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Requested: options for Suggestion 1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).railsFixture.events)).toContain('connect:person-1');
  const rail = page.getByRole('complementary', { name: 'Network overview' });
  await rail.getByRole('button', { name: 'Connections 8', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Connections 8', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Your connected people', { exact: true })).toBeVisible();
  await rail.getByRole('button', { name: 'Workspace invitations 1', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Invitations 3', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Your pending invitations', { exact: true })).toBeVisible();
  await open(page, 'surface=network-layout&guest');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(rail.getByRole('region', { name: 'Your network', exact: true }).getByRole('button')).toHaveCount(0);
  await expect(rail.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/login?redirect=%2Fnetwork');
});

test('Network loading cards use the full page layout and the same card geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, 'surface=network-layout&more');
  const live = (await page.locator('[data-slot="person-card"]').first().boundingBox())!;
  await page.goto(origin + '/?surface=network-loading');
  await expect(page.getByRole('status', { name: 'Loading network', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const loading = (await page.locator('[data-slot="person-card"]').first().boundingBox())!;
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(loading[key]).toBeCloseTo(live[key], 0);
});

test('profile right card: mono section labels in one card, working edit controls', async ({ page }) => {
  await open(page, 'surface=profile');
  for (const title of ['Profile completeness', 'Collaboration', 'Links']) await checkCardSection(page, title);
  await page.getByRole('button', { name: 'Edit role preferences' }).click();
  expect(await page.evaluate(() => (window as any).railsFixture.events)).toEqual(['edit:opportunity']);
  await expect(page.getByRole('link', { name: /Open GitHub/ })).toHaveAttribute('href', /\/go\/profile\//);
  const roleTypes = page.getByRole('list', { name: 'Role types', exact: true });
  const values = await roleTypes.getByRole('listitem').all();
  expect(values).toHaveLength(3);
  const lines = new Set((await Promise.all(values.map(value => value.boundingBox()))).map(rect => Math.round(rect!.y)));
  expect(lines.size).toBeLessThan(3);
  expect(await page.getByRole('heading', { name: 'About', exact: true }).evaluate(el => getComputedStyle(el).fontSize)).toBe('17px');
});

test.describe('mutual connections', () => {
  test.use({ hasTouch: true });
  test('Discover mutual connections use square profile links and exact overflow counts, hiding empty or stale summaries', async ({ page }) => {
    for (const width of [1200, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, 'surface=discover&shared=12');
      await checkHeading(page, 'Mutual connections');
      const shared = page.getByRole('region', { name: 'Mutual connections', exact: true });
      await expect(page.getByRole('link', { name: 'Explore people' })).toHaveCount(0);
      await expect(shared.getByRole('link')).toHaveCount(4);
      await expect(shared.getByText('and 8 others', { exact: true })).toBeVisible();
      const rows = new Set<number>();
      for (let index = 0; index < 4; index++) {
        const avatar = shared.getByRole('link', { name: `View Connection ${index}’s profile`, exact: true });
        await expect(avatar).toHaveAttribute('href', `/u/peer${index}`);
        rows.add(Math.round((await avatar.boundingBox())!.y));
        expect(await avatar.locator('[data-slot="user-avatar"]').evaluate(el => getComputedStyle(el).borderRadius)).toBe('3px');
      }
      expect(rows.size).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await open(page, 'surface=discover&shared=1&compact');
    await expect(page.getByRole('heading', { name: 'Suggested people' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Mutual connections' }).getByRole('link')).toHaveCount(1);
    await expect(page.getByText(/and \d+ others/)).toHaveCount(0);
    await open(page, 'surface=discover&shared=5');
    await expect(page.getByText('and 1 other', { exact: true })).toBeVisible();
    await page.getByRole('region', { name: 'Mutual connections' }).screenshot({ path: test.info().outputPath('shared-connections.png') });
    for (const query of ['surface=discover', 'surface=discover&shared=12&stale']) {
      await open(page, query);
      await expect(page.getByRole('heading', { name: 'Mutual connections' })).toHaveCount(0);
    }
  });
  test('Discover shows additional suggestions below three cards when mutual connections are absent or unavailable', async ({ page }) => {
    for (const query of ['surface=discover&more', 'surface=discover&more&summary-error&compact']) {
      await page.setViewportSize({ width: 320, height: 900 });
      await open(page, query);
      // The cards and the extra faces below them both carry this title.
      await expect(page.getByRole('heading', { name: 'Suggested people', exact: true }).first()).toBeVisible();
      await expect(page.getByText(/^Suggested person person-/)).toHaveCount(3);
      const more = page.getByRole('region', { name: 'Suggested people', exact: true }).last();
      for (let index = 4; index <= 7; index++) {
        await expect(more.getByRole('link', { name: `View Suggestion ${index}’s profile`, exact: true })).toHaveAttribute('href', `/u/suggestion${index}`);
      }
      await expect(more.getByRole('link', { name: 'View more', exact: true })).toHaveAttribute('href', '/network?tab=suggested');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await more.screenshot({ path: test.info().outputPath(`more-people-${query.includes('compact') ? 'compact' : 'desktop'}.png`) });
    }
    await open(page, 'surface=discover&more&shared=12');
    await expect(page.getByRole('heading', { name: 'Mutual connections', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Suggested people', exact: true })).toHaveCount(1);
    await open(page, 'surface=discover&more&unavailable');
    await expect(page.getByRole('heading', { name: 'Suggested people', exact: true })).toHaveCount(1);
  });
});

test('profile empty and visitor states retain visibility and collaboration actions', async ({ page }) => {
  await open(page, 'surface=profile&empty');
  await checkCardSection(page, 'Collaboration');
  await expect(page.getByText('Add your GitHub, LinkedIn or site.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Profile completeness' })).toBeVisible();
  await open(page, 'surface=profile&audience=visitor&empty');
  await expect(page.getByRole('heading', { name: 'Links', exact: true })).toHaveCount(0);
  await expect(page.getByText('No links added yet.', { exact: true })).toHaveCount(0);
  await open(page, 'surface=profile&audience=visitor');
  await expect(page.getByRole('heading', { name: 'Profile completeness' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit role preferences' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Invite to a workspace' }).click();
  await page.getByRole('button', { name: 'See Builder’s open roles' }).click();
  expect(await page.evaluate(() => (window as any).railsFixture.events)).toEqual(['invite', 'apply-profile']);
  await open(page, 'surface=profile&audience=visitor&paused');
  await expect(page.getByRole('heading', { name: 'Collaboration' })).toHaveCount(0);
});

test('project rail preserves Journey controls, activity links and role management', async ({ page }) => {
  await open(page, 'surface=project');
  for (const title of ['Stages', 'Recent activity', 'Open roles']) await checkHeading(page, title);
  const rail = page.getByRole('complementary', { name: 'Workspace details' });
  await rail.getByRole('button', { name: 'Next stage' }).click();
  await expect(rail.getByRole('button', { name: 'Next stage' })).toBeDisabled();
  await rail.getByRole('button', { name: 'Previous stage' }).click();
  await rail.getByRole('button', { name: 'Manage roles' }).click();
  expect(await page.evaluate(() => (window as any).railsFixture.events)).toEqual(['advance', 'previous', 'manage-roles']);
  await expect(rail.getByRole('link', { name: 'Ada joined the workspace' })).toHaveAttribute('href', '/workspaces/example?tab=team');
  await expect(page.getByRole('heading', { name: 'About this workspace' })).toBeVisible();
});

test('project empty, visitor and pending states keep permission boundaries', async ({ page }) => {
  await open(page, 'surface=project&empty');
  await expect(page.getByRole('heading', { name: 'Stages', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Recent activity', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add role' }).click();
  expect(await page.evaluate(() => (window as any).railsFixture.events)).toEqual(['manage-roles']);
  await open(page, 'surface=project&empty&audience=visitor');
  await expect(page.getByRole('heading', { name: 'Open roles', exact: true })).toHaveCount(0);
  await open(page, 'surface=project&audience=visitor');
  await expect(page.getByRole('button', { name: 'Next stage' })).toHaveCount(0);
  await page.getByTitle('Apply for Engineer', { exact: true }).click();
  expect(await page.evaluate(() => (window as any).railsFixture.events)).toEqual(['apply:role-0']);
  await open(page, 'surface=project&audience=visitor&status=pending');
  await expect(page.getByTitle('You already have an application pending review.', { exact: true })).toHaveCount(4);
  for (const button of await page.getByRole('region', { name: 'Open roles', exact: true }).getByRole('button').all()) await expect(button).toBeDisabled();
});

test('activity loading and retry render under the same external heading', async ({ page }) => {
  await open(page, 'surface=project&activity=loading');
  await checkHeading(page, 'Recent activity');
  await expect(page.getByRole('status', { name: 'Loading recent activity' })).toBeVisible();
  await open(page, 'surface=project&activity=error');
  await expect(page.getByRole('alert')).toContainText('Recent activity could not be loaded.');
  await page.evaluate(() => { (window as any).railsFixture.activityFails = false; });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('link', { name: 'Ada joined the workspace' })).toBeVisible();
  await checkHeading(page, 'Recent activity');
});

test.describe('touch layouts', () => {
  test.use({ hasTouch: true });
  test('narrow rails keep headings, dividers and actions visible in both themes', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    for (const theme of ['light', 'dark']) {
      await open(page, `surface=profile&theme=${theme}`);
      for (const title of ['Collaboration', 'Links']) await checkCardSection(page, title);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // the card sits under the main column on phones and keeps completeness (profile mix)
      await expect(page.getByRole('heading', { name: 'Profile completeness' })).toHaveCount(1);
      expect((await page.getByRole('button', { name: 'Edit role preferences' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await open(page, `surface=project&theme=${theme}`);
      for (const title of ['Stages', 'Recent activity', 'Open roles']) await checkHeading(page, title);
      const rail = page.getByRole('complementary', { name: 'Workspace details' });
      for (const name of ['Previous stage', 'Next stage']) expect((await rail.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(rail.getByText('Build (2 of 3)', { exact: true })).toBeVisible();
      const expand = page.getByRole('button', { name: 'Show all 4 roles' });
      await expand.tap();
      await expect(expand).toHaveCount(0);
      const lastRole = rail.getByText('Writer', { exact: true });
      await page.screenshot({ path: test.info().outputPath(`project-rail-mobile-${theme}.png`) });
      await lastRole.scrollIntoViewIfNeeded();
      await expect(lastRole).toBeVisible();
    }
  });
});

test('Network filters apply immediately, retain per-section URL state, and replace history (unified back A2)',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await open(page,'surface=network-layout&more');
 const toolbar=page.locator('.nb-network-toolbar');
 const gap=await toolbar.evaluate(el=>el.getBoundingClientRect().top-el.previousElementSibling!.getBoundingClientRect().bottom);
 expect(gap).toBe(16);
 const tabs=(await page.getByRole('tablist',{name:'Network sections'}).boundingBox())!;
 const search=(await page.getByRole('searchbox',{name:'Search people'}).boundingBox())!;
 expect(search.x-tabs.x-tabs.width).toBeCloseTo(8,0);
 await toolbar.getByRole('button',{name:'Filters',exact:true}).click();
 await page.getByRole('textbox',{name:'Location',exact:true}).fill('Lisbon');
 await expect(page).toHaveURL(/suggested.location=Lisbon/);
 await expect(page.getByRole('dialog')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).railsFixture.lastPeopleQuery.filters.location)).toBe('Lisbon');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await expect(page).toHaveURL(/suggested.location=Lisbon/);
 await toolbar.getByRole('button',{name:/^Filters/}).click();
 await expect(page.getByRole('textbox',{name:'Location',exact:true})).toHaveValue('Lisbon');
 await page.getByRole('textbox',{name:'Location',exact:true}).fill('Lisbon');
 await page.getByRole('checkbox',{name:'Open to collaboration',exact:true}).check();
 await expect(page).toHaveURL(/suggested.open=1/);
 await expect(page.getByRole('dialog')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).railsFixture.lastPeopleQuery.filters.openToCollaborate)).toBe(true);
 const historyLength=await page.evaluate(()=>history.length);
 await page.getByRole('button',{name:'Done',exact:true}).click();
 expect(await page.evaluate(()=>history.length)).toBe(historyLength);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page).toHaveURL(/suggested.location=Lisbon/);
 await expect(page.getByRole('group',{name:'Selected network filters'})).toContainText('Location: Lisbon');
 await page.getByRole('searchbox',{name:'Search people'}).fill('Mira');await expect(page).toHaveURL(/q=Mira/);
 await page.getByRole('tab',{name:'Connections 8',exact:true}).click();
 await expect(page.getByRole('searchbox',{name:'Search connections'})).toHaveValue('');
 await expect(page.getByRole('group',{name:'Selected network filters'})).toHaveCount(0);
 await expect(toolbar.getByRole('combobox')).toHaveCount(0);
 await toolbar.getByRole('button',{name:'Filters',exact:true}).click();
 await page.getByRole('combobox',{name:'Sort connections'}).click();
 await page.getByRole('option',{name:'Name',exact:true}).click();
 await expect(page).toHaveURL(/connections.sort=name/);
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('checkbox',{name:'Open to collaboration',exact:true})).toHaveCount(0);
 await page.getByRole('checkbox',{name:'Mutual connections',exact:true}).check();
 await expect(page).toHaveURL(/connections.shared=1/);
 await page.getByRole('button',{name:'Done',exact:true}).click();await expect(page).toHaveURL(/connections.shared=1/);await expect(page).toHaveURL(/connections.sort=name/);
 await page.getByRole('tab',{name:/^Suggested\b/}).click();
 await expect(page.getByRole('searchbox',{name:'Search people'})).toHaveValue('Mira');
 await expect(page.getByRole('group',{name:'Selected network filters'})).toContainText('Location: Lisbon');
 // Unified back A2 (167e61309): filters replace history, so removing a chip adds no entry and Back leaves Network.
 const beforeRemove=await page.evaluate(()=>history.length);
 await page.getByRole('button',{name:'Remove Location: Lisbon',exact:true}).click();
 await expect(page).not.toHaveURL(/suggested.location/);
 expect(await page.evaluate(()=>history.length)).toBe(beforeRemove);
 await toolbar.getByRole('button',{name:/^Filters/}).click();
 await page.getByRole('textbox',{name:'Location',exact:true}).fill('Lisbon');
 await expect(page).toHaveURL(/suggested.location=Lisbon/);
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await expect(page.getByRole('group',{name:'Selected network filters'})).toContainText('Location: Lisbon');
 await page.getByRole('button',{name:'Clear all',exact:true}).click();
 await expect(page.getByRole('group',{name:'Selected network filters'})).toHaveCount(0);
 await expect(page.getByRole('searchbox',{name:'Search people'})).toHaveValue('Mira');
 await expect(toolbar.getByRole('button',{name:'Filters',exact:true})).toBeFocused();
 await page.getByRole('tab',{name:'Invitations 3',exact:true}).click();
 await toolbar.getByRole('button',{name:'Filters',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Location',exact:true})).toHaveCount(0);
 await page.getByRole('combobox',{name:'Invitation direction'}).click();await page.getByRole('option',{name:'Sent',exact:true}).click();await expect(page).toHaveURL(/invitations.direction=sent/);
 await page.getByRole('combobox',{name:'Invitation type'}).click();await page.getByRole('option',{name:'Workspace invitations and applications',exact:true}).click();await expect(page).toHaveURL(/invitations.kind=projects/);
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await expect(page).toHaveURL(/invitations.direction=sent/);await expect(page).toHaveURL(/invitations.kind=projects/);
 await page.reload();await expect(page.getByRole('group',{name:'Selected network filters'})).toContainText('Role applications');
 await page.getByRole('tab',{name:/^Suggested\b/}).click();
 await page.getByRole('searchbox',{name:'Search people'}).fill('Last keystrokes');
 await page.getByRole('tab',{name:'Connections 8',exact:true}).click();
 await page.getByRole('tab',{name:/^Suggested\b/}).click();
 await expect(page.getByRole('searchbox',{name:'Search people'})).toHaveValue('Last keystrokes');
});

test('Network tab underlines stay on the divider in every section and compact layout',async({page})=>{
 for(const width of [1440,1200,900,768,390,320]){
  await page.setViewportSize({width,height:900});await open(page,'surface=network-layout&more');
  for(const name of [/^Suggested\b/,'Invitations 3','Connections 8']){
   await page.getByRole('tab',{name,exact:true}).click();
   const gap=await page.getByRole('tab',{name,exact:true}).evaluate(el=>el.closest('[role=tablist]')!.parentElement!.getBoundingClientRect().bottom-el.getBoundingClientRect().bottom);
   expect(Math.abs(gap),`${name} at ${width}`).toBeLessThanOrEqual(.5);
   expect(await page.locator('.nb-network-main').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  }
 }
});

test('Network failed next pages retain cards and wait for an explicit retry; empty filtered results can reset',async({page})=>{
 await open(page,'surface=network-layout&more&page-error');
 await expect(page.locator('[data-slot=person-card]')).toHaveCount(7);
 await expect(page.getByRole('alert')).toContainText('More people could not be loaded');
 await page.waitForTimeout(700);
 expect(await page.evaluate(()=>(window as any).railsFixture.events)).not.toContain('retry-page');
 await page.getByRole('button',{name:'Retry loading more',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).railsFixture.events.filter((event:string)=>event==='retry-page').length)).toBe(1);
 await open(page,'surface=network-layout&empty&suggested.location=Lisbon&q=Mira');
 await expect(page.getByText('No people match your search or filters',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Reset search and filters',exact:true}).click();
 await expect(page.getByRole('searchbox',{name:'Search people'})).toHaveValue('');
 await expect(page.getByRole('group',{name:'Selected network filters'})).toHaveCount(0);
});

test.describe('Network touch controls',()=>{
 test.use({hasTouch:true});
 test('tabs remain on the divider with accessible search and filter targets',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page,'surface=network-layout&more');
  expect((await page.getByRole('searchbox',{name:'Search people'}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await page.locator('.nb-network-toolbar').getByRole('button',{name:'Filters',exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const gap=await page.getByRole('tab',{name:/^Suggested\b/}).evaluate(el=>el.closest('[role=tablist]')!.parentElement!.getBoundingClientRect().bottom-el.getBoundingClientRect().bottom);
  expect(Math.abs(gap)).toBeLessThanOrEqual(.5);
 });
});

test('Network reuses Discover filter drawer geometry and keeps sorting inside the panel',async({page})=>{
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:844});
  await open(page,'surface=discover-layout');
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  const reference=page.getByRole('dialog',{name:'Filters',exact:true});
  await expect(reference).toHaveAttribute('data-presentation',width>=768?'right-drawer':'bottom-sheet');
  await expect.poll(async()=> (await reference.boundingBox())!.x).toBeCloseTo(width>=768?width-420:0,0);
  if(width<768)await expect.poll(async()=>{const r=(await reference.boundingBox())!;return r.y+r.height;}).toBeCloseTo(844,0);
  const referenceBox=(await reference.boundingBox())!;
  const presentation=await reference.getAttribute('data-presentation');
  const referenceHeader=await reference.locator('[data-slot=dialog-title]').evaluate(el=>{const s=getComputedStyle(el);return [s.fontFamily,s.fontSize,s.fontWeight];});
  await expect(reference.getByRole('button',{name:'Clear all',exact:true})).toBeDisabled();
  await reference.getByText('Active',{exact:true}).click();
  await expect(reference.getByRole('button',{name:'Clear all',exact:true})).toBeEnabled();
  await reference.getByRole('button',{name:'Done',exact:true}).click();
  await open(page,'surface=network-layout&more');
  const toolbar=page.locator('.nb-network-toolbar');
  await expect(toolbar.getByText('Recommended',{exact:true})).toHaveCount(0);
  await expect(toolbar.getByText('Best match',{exact:true})).toHaveCount(0);
  for(const name of [/^Suggested\b/,'Invitations 3','Connections 8']){
   await page.getByRole('tab',{name,exact:true}).click();
   await expect(toolbar.getByRole('combobox')).toHaveCount(0);
   await toolbar.getByRole('button',{name:/^Filters/}).click();
   const panel=page.getByRole('dialog',{name:'Filters',exact:true});
   await expect(panel).toHaveAttribute('data-presentation',presentation!);
   await expect.poll(async()=> (await panel.boundingBox())!.x).toBeCloseTo(width>=768?width-420:0,0);
   if(width<768)await expect.poll(async()=>{const r=(await panel.boundingBox())!;return r.y+r.height;}).toBeCloseTo(844,0);
   const box=(await panel.boundingBox())!;
   expect(box.x).toBeCloseTo(referenceBox.x,0);expect(box.width).toBeCloseTo(referenceBox.width,1);
   if(width>=768){expect(box.y).toBe(referenceBox.y);expect(box.height).toBe(referenceBox.height);}
   else {expect(box.y+box.height).toBeCloseTo(844,0);expect(box.height).toBeLessThanOrEqual(844*.85+1);}
   expect(await panel.locator('[data-slot=dialog-title]').evaluate(el=>{const s=getComputedStyle(el);return [s.fontFamily,s.fontSize,s.fontWeight];})).toEqual(referenceHeader);
   const footer=panel.locator('[data-slot=dialog-footer]');
   await expect(footer).toHaveAttribute('data-paper','true');
   await expect(footer.getByRole('button',{name:'Done',exact:true})).toBeVisible();
   if(typeof name!=='string')await expect(panel.getByRole('combobox',{name:/Sort/})).toHaveCount(0);
   else {
    const sort=panel.getByRole('combobox',{name:name.startsWith('Invitations')?'Sort invitations':'Sort connections'});
    await sort.click();await page.getByRole('option',{name:name.startsWith('Invitations')?'Oldest':'Name',exact:true}).click();
   }
   await footer.getByRole('button',{name:'Done',exact:true}).click();
   // Safari doesn't focus a button on click, so there is no focus to return.
   if(test.info().project.name!=='webkit')await expect(toolbar.getByRole('button',{name:/^Filters/})).toBeFocused();
   if(name==='Invitations 3')await expect(page).toHaveURL(/invitations.sort=oldest/);
   if(name==='Connections 8'){
    await expect(page).toHaveURL(/connections.sort=name/);
    await toolbar.getByRole('button',{name:/^Filters/}).click();
    const reset=page.getByRole('dialog');await reset.getByRole('button',{name:'Clear all',exact:true}).click();await expect(page).not.toHaveURL(/connections.sort=name/);await expect(reset).toBeVisible();
    await expect(reset.getByRole('combobox',{name:'Sort connections'})).toContainText('Recently connected');
    await reset.getByRole('button',{name:'Done',exact:true}).click();await expect(page).not.toHaveURL(/connections.sort=name/);
   }
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});

test('Network skills, location and Clear all update the feed while the panel stays open',async({page})=>{
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:844});await open(page,'surface=network-layout&more');
  await page.locator('.nb-network-toolbar').getByRole('button',{name:'Filters',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'Filters',exact:true});
  await panel.getByRole('combobox',{name:'Skills',exact:true}).fill('React');
  await panel.getByRole('option').filter({has:page.getByText('React',{exact:true})}).click();
  await expect(page).toHaveURL(/suggested.skill=React/);
  expect(await page.evaluate(()=>(window as any).railsFixture.lastPeopleQuery.filters.skills)).toEqual(['React']);
  await panel.getByRole('textbox',{name:'Location',exact:true}).pressSequentially('New York');
  await expect(page).toHaveURL(/suggested.location=New\+York/);
  await expect(panel.getByRole('textbox',{name:'Location',exact:true})).toHaveValue('New York');
  await panel.getByRole('checkbox',{name:'Mutual connections',exact:true}).check();
  await expect(page).toHaveURL(/suggested.shared=1/);
  await expect(panel).toBeVisible();
  const beforeClear=await page.evaluate(()=>history.length);
  await panel.getByRole('button',{name:'Clear all',exact:true}).click();
  await expect(page).not.toHaveURL(/suggested.(skill|location|shared)=/);
  // Unified back A2: Clear all replaces history (no new entry), like every filter change.
  expect(await page.evaluate(()=>history.length)).toBe(beforeClear);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button',{name:'Clear all',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>(window as any).railsFixture.lastPeopleQuery.filters)).toMatchObject({skills:[],location:'',hasMutuals:false});
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/suggested.shared=1/);
 }
});

test('Network keeps its entire page in skeleton state until the first people request settles',async({page})=>{
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  await page.goto(origin+'/?surface=network-layout&more&initial-loading');
  const loading=page.getByRole('status',{name:'Loading network',exact:true});
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute('aria-busy','true');
  await expect(loading.locator('.nb-network-main > div').first().locator('.nb-skeleton')).toHaveCount(2);
  await expect(loading.locator('.nb-network-toolbar .nb-skeleton')).toHaveCount(5);
  await expect(page.getByRole('heading',{name:'Network',exact:true})).toHaveCount(0);
  await expect(page.getByRole('searchbox',{name:'Search people',exact:true})).toHaveCount(0);
  await expect(page.locator('[data-page-search]')).toHaveCount(0);
  await expect(page.getByRole('tablist',{name:'Network sections',exact:true})).toHaveCount(0);
  await expect(page.getByRole('complementary',{name:'Network overview',exact:true})).toHaveCount(0);
  await page.evaluate(()=>{(window as any).railsFixture.peopleReady=true;window.dispatchEvent(new Event('people-ready'));});
  await expect(loading).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Network',exact:true})).toBeVisible();
  await expect(page.getByRole('searchbox',{name:'Search people',exact:true})).toBeVisible();
  await expect(page.locator('[data-page-search]')).toHaveCount(1);
  await expect(page.locator('[data-slot=person-card]')).toHaveCount(7);
  await page.getByRole('searchbox',{name:'Search people',exact:true}).fill('React');
  await expect(page).toHaveURL(/q=React/);
  await expect(loading).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});

test('Network first-load errors reveal recovery instead of leaving the skeleton stuck',async({page})=>{
 await page.goto(origin+'/?surface=network-layout&initial-error');
 await expect(page.getByRole('heading',{name:'Network',exact:true})).toBeVisible();
 await expect(page.getByRole('alert')).toContainText('People didn’t load');
 await expect(page.getByRole('status',{name:'Loading network',exact:true})).toHaveCount(0);
 await page.goto(origin+'/?surface=network-layout&render-error');
 await expect(page.getByRole('heading',{name:'Network',exact:true})).toBeVisible();
 await expect(page.getByText('Couldn’t load suggested people.',{exact:true})).toBeVisible();
 await expect(page.getByRole('status',{name:'Loading network',exact:true})).toHaveCount(0);
 await page.evaluate(()=>{(window as any).railsFixture.renderRecovered=true;});
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.locator('[data-slot=person-card]')).toHaveCount(1);
});
