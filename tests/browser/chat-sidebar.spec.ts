import { exportedNames, serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';

// Board/review report §7: a team workspace's channel sits inside its organization's group, in both views.
const origin = 'https://chat-sidebar.test';
let script: string, css: string;

const channel = (id: string, project: string, name: string, extra = '') => `{id:'${id}',kind:'channel',name:'${name}',topic:null,project_id:'${project}',application_id:null,is_default:true,last_seq:5,last_top_seq:5,last_read_seq:5,mention_count:0,
  notify:'all',starred:false,archived_at:null,channel_archived_at:null,last_message_at:null,last_preview:null,last_author_id:null,member_count:3,role:'member',dm_user:null,members_preview:null${extra}}`;
const FALCON = '11111111-1111-4111-8111-111111111111', LONE = '22222222-2222-4222-8222-222222222222';
const BIG = Array.from({ length: 20 }, (_, i) => channel(`big-${i}`, 'big', `ch-${String(i + 1).padStart(2, '0')}`, i ? ',is_default:false' : '')).join(',');
const shell = `
const data = { server_time: new Date().toISOString(), activity_latest_at: null, channels: [
  ${channel('c-gen', 'cse', 'general')}, ${channel(FALCON, 'falcon', 'team-falcon-hash-table-library', ",last_seq:9,mention_count:1")},
  ${channel('c-o1', 'osprey', 'osprey-general')}, ${channel('c-o2', 'osprey', 'osprey-design', ',is_default:false')}, ${channel('c-nfb', 'nfb', 'general')}, ${channel('c-nfb2', 'nfb', 'random', ',is_default:false,last_seq:8,last_top_seq:8')}, ${channel(LONE, 'lone', 'compiler-lab')}, ${BIG}],
  projects: [
    { id: 'cse', title: 'CSE 3B · Data Structures 2026', slug: 'cse', cover_image: null, role: 'owner', kind: 'organization', parent_id: null },
    { id: 'falcon', title: 'Team Falcon: Hash table library', slug: 'falcon', cover_image: null, role: 'member', kind: 'workspace', parent_id: 'cse', parent_title: 'CSE 3B' },
    { id: 'osprey', title: 'Team Osprey', slug: 'osprey', cover_image: null, role: 'member', kind: 'workspace', parent_id: 'cse', parent_title: 'CSE 3B' },
    { id: 'nfb', title: 'Network for builders', slug: 'nfb', cover_image: null, role: 'owner', kind: 'workspace', parent_id: null },
    { id: 'big', title: 'Big Studio', slug: 'big', cover_image: null, role: 'member', kind: 'workspace', parent_id: null },
    { id: 'lone', title: 'Compiler Lab', slug: 'lone', cover_image: null, role: 'viewer', kind: 'workspace', parent_id: 'cse-3a', parent_title: 'CSE-3A' },
  ] };
export const useChatShell = () => ({ data, loadError: null, refresh: async () => {} });
export const ChatShellProvider = ({ children }) => children;`;

test.beforeAll(async () => {
  const mocks: Record<string, string> = {
    'next/link': `import React from 'react';export default ({href,children,prefetch,...p})=>React.createElement('a',{href,...p},children);`,
    '@/hooks/useAuth': `export const useAuth=()=>({user:{id:'me'},profile:{id:'me',username:'me',fullName:'Me',avatarUrl:null}});`,
    '@/components/messages/ChatShellProvider': shell,
    // ?w= picks a workspace; otherwise the real choice from the URL (an open channel's workspace).
    '@/components/messages/useSelectedWorkspace': `import { useSelectedWorkspace as real } from ${JSON.stringify(path.resolve('src/components/messages/useSelectedWorkspace.ts'))};export const useSelectedWorkspace=()=>{const r=real();return new URLSearchParams(location.search).get('w') ?? r;};`,
    'next/navigation': `export const usePathname=()=>location.pathname,useRouter=()=>({push(){},replace(){},refresh(){},prefetch(){}}),useSearchParams=()=>new URLSearchParams(location.search);`,
    '@/components/presence/usePresence': `export const usePersonPresence=()=>null;`,
  };
  // Every other presence hook answers "nobody's around".
  const own = new Set(exportedNames(mocks['@/components/presence/usePresence']!));
  mocks['@/components/presence/usePresence'] += exportedNames(await readFile('src/components/presence/usePresence.ts', 'utf8').catch(() => readFile('src/components/presence/usePresence.tsx', 'utf8')))
    .filter((n) => !own.has(n)).map((n) => `export const ${n}=()=>null;`).join('');
  const out = await build({ entryPoints: [path.resolve('tests/browser/chat-sidebar.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'chat-sidebar', setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
  } }, serverActionsPlugin] });
  script = out.outputFiles![0]!.text;
  css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css
    + await readFile('src/components/messages/messages-mix.css', 'utf8');
});

async function open(page: Page, path = '') {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route(origin + '/**', (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html lang="en"><head><title>Chat</title><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
    return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.goto(`${origin}/messages${path}`);
}

test('all workspaces: teams sit inside their organization; an outside team stays alone with its organization named', async ({ page }) => {
  await open(page);
  const headings = page.getByRole('heading', { level: 2 });
  await expect(headings.filter({ hasText: 'Team Falcon' })).toHaveCount(0);
  await expect(headings.filter({ hasText: 'Team Osprey' })).toHaveCount(0);
  const org = page.locator('section').filter({ has: page.getByRole('button', { name: /CSE 3B · Data Structures 2026/ }) });
  await expect(org).toContainText('Team workspaces');
  await expect(org.getByRole('link', { name: /team-falcon-hash-table-library/ })).toBeVisible();
  await expect(org.getByRole('button', { name: /Team Osprey/ })).toContainText('2 channels');
  await expect(headings.filter({ hasText: 'Compiler Lab' })).toContainText('CSE-3A');
  // Names aren't cut down to a few letters any more.
  const title = page.getByRole('button', { name: 'Network for builders', exact: true });
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test('organization open: team channels are inside Channels, under Team workspaces, with no team headings', async ({ page }) => {
  await open(page, '?w=cse');
  const channels = page.locator('section').filter({ has: page.getByRole('button', { name: /^Channels/ }) });
  await expect(channels.getByRole('link', { name: 'general', exact: true })).toBeVisible();
  await expect(channels).toContainText('Team workspaces');
  await expect(channels.getByRole('link', { name: /team-falcon-hash-table-library/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: 'Team Falcon' })).toHaveCount(0);
  // A team's mention counts toward Channels.
  await expect(page.getByRole('heading', { name: /Channels , 1 mentions/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('chat-sidebar-org.png') });
});

test('opening a team channel keeps its organization selected: the same Channels, with the team row marked', async ({ page }) => {
  await open(page, `/${FALCON}`);
  await expect(page.getByRole('button', { name: /CSE 3B · Data Structures 2026/ }).first()).toBeVisible();
  const channels = page.locator('section').filter({ has: page.getByRole('button', { name: /^Channels/ }) });
  await expect(channels.getByRole('link', { name: 'general', exact: true })).toBeVisible();
  await expect(channels.getByRole('link', { name: /team-falcon-hash-table-library/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: /Team Falcon: Hash table library/ })).toHaveCount(0);
});

test('someone in a team but not its organization still gets the team on its own', async ({ page }) => {
  await open(page, `/${LONE}`);
  const channels = page.locator('section').filter({ has: page.getByRole('button', { name: /^Channels/ }) });
  await expect(channels.getByRole('link', { name: /compiler-lab/ })).toHaveAttribute('aria-current', 'page');
  await expect(channels.getByRole('link', { name: 'general', exact: true })).toHaveCount(0);
});

// Messages mix (Phase 2, Task 5): counts, the unread square, section labels, the selected row.
test('mix: counts are square mono two-digit chips, clay for mentions', async ({ page }) => {
  await open(page, '?w=cse');
  const count = page.getByRole('link', { name: /team-falcon-hash-table-library/ }).locator('.nbm-count');
  await expect(count).toHaveText(/^01/);
  await expect(count).toHaveClass(/\bhot\b/);
  expect(parseFloat(await count.evaluate((el) => getComputedStyle(el).borderTopLeftRadius))).toBeLessThanOrEqual(4);
});

test('mix: an unread channel without mentions shows the 6px square, not a count', async ({ page }) => {
  await open(page);
  const row = page.getByRole('link', { name: /^random/ });
  await expect(row.locator('.nbm-sq')).toHaveCount(1);
  await expect(row.locator('.nbm-count')).toHaveCount(0);
});

test('mix: a section label shows its row count in mono; the heading name is unchanged', async ({ page }) => {
  await open(page, '?w=cse');
  await expect(page.getByRole('heading', { name: /Channels , 1 mentions/ })).toBeVisible();
  const label = page.locator('.nb-chat-section-title').filter({ hasText: /^Channels/ }).locator('b[aria-hidden="true"]');
  await expect(label).toHaveText(/^\d{2}$/);
});

test('mix: the open row is a soft fill with no edge bar', async ({ page }) => {
  await open(page, `/${FALCON}`);
  const row = page.getByRole('link', { name: /team-falcon-hash-table-library/ });
  const style = await row.evaluate((el) => { const s = getComputedStyle(el); return { left: s.borderLeftWidth, bg: s.backgroundColor, radius: s.borderTopLeftRadius }; });
  expect(style.left).toBe('0px');
  expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(parseFloat(style.radius)).toBe(0);
});

test('mix: the workspace cell names the workspace with a mono sub line', async ({ page }) => {
  await open(page, '?w=nfb');
  const cell = page.getByTestId('chat-project-switcher');
  await expect(cell).toContainText('Network for builders');
  await expect(cell.locator('.nbm-ws-sub')).toHaveText(/^Workspace · 3 people$/);
  expect(await cell.evaluate((el) => el.getBoundingClientRect().height)).toBe(56);
  await open(page);
  await expect(page.getByTestId('chat-project-switcher').locator('.nbm-ws-sub')).toHaveText(/^\d+ workspaces$/);
});

test('mix: Jump to… on the page opens the switcher', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Jump to…/ }).click();
  await expect(page.getByTestId('switcher-open')).toHaveText('true');
});

test('mix: All | Unread is a two-cell switch; Unread shows the note', async ({ page }) => {
  await open(page);
  const group = page.getByRole('group', { name: 'Show' });
  const all = group.getByRole('button', { name: 'All' }), unread = group.getByRole('button', { name: 'Unread' });
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await unread.click();
  await expect(unread).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('Showing unread only')).toBeVisible();
  await page.getByRole('button', { name: 'Show all' }).click();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
});

test('mix: unread in another workspace is a 6px square', async ({ page }) => {
  await open(page, '?w=nfb');
  const mark = page.getByTestId('chat-project-switcher').locator('.nbm-sq');
  await expect(mark).toHaveCount(1);
  const box = await mark.evaluate((el) => { const s = getComputedStyle(el); return [s.width, s.height, s.borderRadius]; });
  expect(box).toEqual(['6px', '6px', '0px']);
});

test('mix: a long channel list stops at 12 read rows with "N more channels"', async ({ page }) => {
  await open(page, '?w=big');
  const more = page.getByRole('button', { name: '8 more channels' });
  await expect(more).toBeVisible();
  await expect(page.getByRole('link', { name: /^ch-13/ })).toHaveCount(0);
  await more.click();
  await expect(page.getByRole('link', { name: /^ch-20/ })).toBeVisible();
  await page.getByRole('button', { name: 'Show fewer' }).click();
  await expect(page.getByRole('link', { name: /^ch-20/ })).toHaveCount(0);
});

test('mix: every row carries its full name as a title', async ({ page }) => {
  await open(page);
  const row = page.getByRole('link', { name: /team-falcon-hash-table-library/ });
  await expect(row).toHaveAttribute('title', 'team-falcon-hash-table-library');
});

test('mix: 1024–1279 with a drawer open, "Show conversations" brings the sidebar back as a sheet; Esc closes it', async ({ page }) => {
  await open(page, '?sheet=1');
  await page.setViewportSize({ width: 1180, height: 900 });
  const toggle = page.getByRole('button', { name: 'Show conversations' });
  const sidebar = page.getByRole('complementary', { name: 'Conversations' });
  await expect(sidebar).toBeHidden();
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(sidebar).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await sidebar.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(toggle).toBeHidden();
  await expect(sidebar).toBeVisible();
});
