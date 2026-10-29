import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import type { Page, Route } from '@playwright/test';

// The real Settings document in a real browser. Everything inside it is the app's own code; only its edges are
// replaced: server actions (answered by window.__actions), the auth context, Next's router, and the network
// (answered by Playwright routes below).
export const origin = 'https://settings-real.test';
const EDGES = [/^@\/app\/actions\//, /^@\/lib\/files-tab-batch$/, /^@\/lib\/supabase\/(client|server)$/];
const MOCKS: Record<string, string> = {
  'next/navigation': `const router={replace:h=>window.settingsFixture.navigate(h,true),push:h=>window.settingsFixture.navigate(h,false),refresh(){}};export const useRouter=()=>router;export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;`,
  'next/link': `import React from 'react';export default ({href,children,...p})=>React.createElement('a',{href,...p},children);`,
  'next/dynamic': `import React from 'react';export default (loader)=>{const L=React.lazy(()=>loader().then(m=>({default:m.default??m})));return (props)=>React.createElement(React.Suspense,{fallback:null},React.createElement(L,props));};`,
  'server-only': `export {};`,
  '@/hooks/use-auth': `export const useAuth=()=>window.__auth;`,
};

let built: { script: string; css: string; sans: Buffer; mono: Buffer } | null = null;
export async function buildRealSettings() {
  if (built) return built;
  const bundle = await build({
    entryPoints: [path.resolve('tests/browser/real-settings.fixture.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'edges', setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.path in MOCKS) return { path: args.path, namespace: 'mock' };
        if (EDGES.some((re) => re.test(args.path))) return { path: args.path, namespace: 'action' };
      });
      b.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: MOCKS[args.path], resolveDir: process.cwd(), loader: 'js' }));
      b.onLoad({ filter: /.*/, namespace: 'action' }, (args) => {
        const rel = args.path.replace('@/', 'src/');
        const file = ['.ts', '.tsx'].map((ext) => rel + ext).find((candidate) => { try { readFileSync(candidate); return true; } catch { return false; } })!;
        const names = new Set([...readFileSync(file, 'utf8').matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]));
        return { contents: [...names].map((n) => `export const ${n}=(...a)=>window.__actions.${n}(...a);`).join('\n') + '\nexport default {};', loader: 'js' };
      });
    } }],
  });
  const result = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const [sans, mono] = await Promise.all([readFile('src/app/fonts/InstrumentSans.ttf'), readFile('src/app/fonts/JetBrainsMono.ttf')]);
  const css = `@font-face{font-family:'Instrument Sans';src:url('/sans.ttf');font-weight:400 700;}@font-face{font-family:'JetBrains Mono';src:url('/mono.ttf');font-weight:100 800;}:root{--font-instrument-sans:'Instrument Sans';--font-jetbrains-mono:'JetBrains Mono';}` + result.css;
  built = { script: bundle.outputFiles![0]!.text, css, sans, mono };
  return built;
}

export type Api = {
  /** Called for every /api request: return a JSON body to answer it (add __status for a non-200), or undefined to use the default answer. */
  respond?: (method: string, url: URL, body: unknown) => unknown | Promise<unknown>;
  /** Server actions by name; anything not listed answers { success: true }. */
  actions?: Record<string, (...args: unknown[]) => unknown>;
  auth?: Record<string, unknown>;
};

const iso = (daysAgo: number) => new Date(Date.UTC(2026, 9, 28 - daysAgo, 10, 0, 0)).toISOString();
const ok = (data: unknown) => ({ success: true, data });

export const sampleData = {
  sessions: (from: number, count: number) => Array.from({ length: count }, (_, n) => ({ id: `s${from + n}`, created_at: iso(from + n), last_active: iso(from + n), ip_address: '203.0.113.5', aal: 'aal1', is_current: from + n === 0, device_info: { userAgent: from + n === 0 ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Chrome/120.0 Safari/605.1.15' : 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari' } })),
  activity: (from: number, count: number) => Array.from({ length: count }, (_, n) => ({ id: `a${from + n}`, eventType: 'password_changed', createdAt: iso(from + n), networkFingerprint: 'a3f9', deviceFingerprint: 'b7c1', metadata: {} })),
  privacyActivity: (count: number) => Array.from({ length: count }, (_, n) => ({ id: `p${n}`, eventType: 'profile_visibility_changed', createdAt: iso(n), label: `Profile visibility ${n}`, summary: 'Changed.' })),
  blocked: (from: number, count: number) => Array.from({ length: count }, (_, n) => ({ id: `b${from + n}`, username: `person${from + n}`, fullName: `Person ${from + n}`, avatarUrl: null, headline: 'Builder', blockedAt: iso(1) })),
};

function defaultAnswer(method: string, url: URL): unknown {
  const p = url.pathname;
  if (p === '/api/v1/security' && url.searchParams.get('activityBefore')) return ok({ securityActivity: sampleData.activity(8, 3), securityActivityHasMore: false });
  if (p === '/api/v1/security') return ok({ mfaFactors: [], sessions: sampleData.sessions(0, 3), sessionsNextOffset: 3, loginHistory: [], password: { hasPassword: true, lastChangedAt: iso(30) }, recoveryCodes: { configured: false, remainingCount: 0 }, securityActivity: sampleData.activity(0, 8), securityActivityHasMore: true, assurance: { currentLevel: 'aal1', nextLevel: 'aal1' } });
  if (p === '/api/v1/sessions') return ok({ sessions: sampleData.sessions(3, 2), pagination: { limit: 12, offset: 3, hasMore: false, nextOffset: null } });
  if (p === '/api/v1/privacy/blocks') return ok({ accounts: sampleData.blocked(2, 2), nextCursor: null });
  if (p === '/api/v1/privacy') return ok({ settings: { profileVisibility: 'public', messagePrivacy: 'connections', connectionPrivacy: 'everyone', blockedCount: 4 }, blockedAccounts: sampleData.blocked(0, 2), blockedAccountsNextCursor: 'next', privacyActivity: sampleData.privacyActivity(7) });
  if (p === '/api/v1/account/deletion-preflight') return ok({ projects: [{ id: 'p1', title: 'Garden Map', slug: 'garden-map', otherMembers: 2 }, { id: 'p2', title: 'Solo Notes', slug: 'solo-notes', otherMembers: 0 }] });
  if (p === '/api/v1/appearance') return ok({ userId: 'u1', snapshot: null, remoteSynced: true });
  if (p === '/api/v1/integrations') return ok({ summary: 'You sign in with email.', authConnections: [{ provider: 'google', label: 'Google', state: 'not_linked', detail: 'Not linked to this account.' }, { provider: 'github', label: 'GitHub', state: 'not_linked', detail: 'Not linked to this account.' }, { provider: 'email', label: 'Email', state: 'primary', detail: 'ada@example.com' }], githubService: { status: 'not_connected', summary: 'No GitHub repository access is currently in use.', detail: 'Connect GitHub from a workspace when repository access is needed.', usageCount: 0, recoveryAction: null } });
  if (p === '/api/v1/legal/acceptance') return ok({ current: true, versions: {}, history: [], latest: null });
  if (p === '/api/v1/account/export-status') return ok({ lastExportedAt: null });
  return ok({});
}

export async function openRealSettings(page: Page, api: Api = {}) {
  const assets = await buildRealSettings();
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  await page.addInitScript(() => { (window as any).process = { env: { NODE_ENV: 'test' } }; });
  await page.addInitScript(({ auth }) => {
    (window as any).__auth = { user: { id: 'u1', email: 'ada@example.com', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [{ provider: 'email' }] }, profile: { username: 'ada', fullName: 'Ada Lovelace', avatarUrl: null }, isAuthenticated: true, isLoading: false, signOut: async () => {}, ...auth };
  }, { auth: api.auth ?? {} });
  const baseActions: Record<string, (...args: any[]) => unknown> = {
    readShellSummaryAction: (parts: string[]) => Object.fromEntries(parts.map((part) => [part, part === 'notificationPreferences' ? { success: true, preferences: {} } : { success: true }])),
    getAccountDeletionStatus: () => ({ pending: false }),
    getMyPresenceSettings: () => ({ success: true, settings: { status: null, showActivity: true, statusVisibility: 'connections' } }),
    getPresence: () => ({ success: true, presence: [] }),
    getProjectStatuses: () => ({ success: true, projects: [] }),
    updateNotificationPreferencesAction: (next: unknown) => ({ success: true, preferences: next }),
    readActiveExtensionSessions: () => ({ success: true, sessions: [], hasMore: false, nextCursor: null }),
    getActiveExtensionSessions: () => ({ success: true, sessions: [], hasMore: false, nextCursor: null }),
    listMyOrganizationsAction: () => [],
  };
  const actions = { ...baseActions, ...(api.actions ?? {}) } as Record<string, (...args: unknown[]) => unknown>;
  await page.exposeFunction('__runAction', async (name: string, args: unknown[]) => (actions[name] ? await actions[name]!(...args) : { success: true }));
  await page.addInitScript(() => {
    (window as any).__actions = new Proxy({}, { get: (_t, name: string) => (...args: unknown[]) => (window as any).__runAction(name, args) });
  });
  await page.route(origin + '/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/sans.ttf' || url.pathname === '/mono.ttf') return route.fulfill({ contentType: 'font/ttf', body: url.pathname === '/sans.ttf' ? assets.sans : assets.mono });
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'application/javascript', body: assets.script });
    if (url.pathname === '/app.css') return route.fulfill({ contentType: 'text/css', body: assets.css });
    if (url.pathname.startsWith('/api/')) {
      let body: unknown = null;
      try { body = request.postDataJSON(); } catch { /* no body */ }
      calls.push({ method: request.method(), path: url.pathname + url.search, body });
      const custom = await api.respond?.(request.method(), url, body);
      const answer = custom !== undefined ? custom : defaultAnswer(request.method(), url);
      const { __status: status = 200, ...payload } = (answer ?? {}) as { __status?: number };
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    }
    return route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head><title>Settings</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>' });
  });
  await page.goto(origin + '/settings');
  return { calls };
}
