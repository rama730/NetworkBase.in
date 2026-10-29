import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import type { Page, Route } from '@playwright/test';

// Real app components in a real browser (the app's own stylesheet and font), with only the edges replaced: server
// actions answer from window.__actions, auth comes from window.__auth, and next/navigation is a tiny router the
// fixture controls. Used where behaviour spans several components, like the welcome flight.
export const origin = 'https://app-bundle.test';
const EDGES = [/^@\/app\/actions\//, /^@\/lib\/files-tab-batch$/, /^@\/lib\/supabase\/(client|server)$/];
const MOCKS: Record<string, string> = {
  'next/navigation': `import React from 'react';const r={push:h=>window.__router.push(h),replace:h=>window.__router.push(h),refresh(){},prefetch(){},back(){}};export const useRouter=()=>r;export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>React.useSyncExternalStore(window.__router.subscribe,window.__router.get);export const useParams=()=>({});export const redirect=()=>{};export const notFound=()=>{};`,
  'next/link': `import React from 'react';export default React.forwardRef(({href,children,prefetch,scroll,replace,...p},ref)=>React.createElement('a',{href:typeof href==='string'?href:'#',ref,...p},children));`,
  'next/image': `import React from 'react';export default ({src,alt,width,height,fill,priority,unoptimized,sizes,quality,placeholder,blurDataURL,loader,fetchPriority,...p})=>React.createElement('img',{src:typeof src==='string'?src:(src&&src.src)||'',alt,width,height,...p});`,
  'next/dynamic': `import React from 'react';export default (loader)=>{const L=React.lazy(()=>loader().then(m=>({default:m.default??m})));return (props)=>React.createElement(React.Suspense,{fallback:null},React.createElement(L,props));};`,
  'server-only': `export {};`,
  '@/hooks/use-auth': `export const useAuth=()=>window.__auth;`,
  '@/components/providers/AuthProvider': `export const useAuthContext=()=>window.__auth;export const AuthProvider=({children})=>children;export default {};`,
};

const cache = new Map<string, { script: string; css: string; sans: Buffer; mono: Buffer }>();
export async function buildApp(entry: string) {
  const hit = cache.get(entry);
  if (hit) return hit;
  const bundle = await build({
    entryPoints: [path.resolve(entry)], bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'error', define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'edges', setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.path in MOCKS) return { path: args.path, namespace: 'mock' };
        if (EDGES.some((re) => re.test(args.path))) return { path: args.path, namespace: 'action' };
      });
      b.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: MOCKS[args.path], resolveDir: process.cwd(), loader: 'js' }));
      b.onLoad({ filter: /.*/, namespace: 'action' }, (args) => {
        const rel = args.path.replace('@/', 'src/');
        const file = ['.ts', '.tsx', '/index.ts'].map((ext) => rel + ext).find((candidate) => { try { readFileSync(candidate); return true; } catch { return false; } })!;
        const text = readFileSync(file, 'utf8');
        const names = new Set([...text.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]));
        for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop()!.trim(); if (n && !n.startsWith('type ')) names.add(n); }
        return { contents: [...names].map((n) => `export const ${n}=(...a)=>(window.__actions&&window.__actions.${n}?window.__actions.${n}(...a):Promise.resolve({success:true}));`).join('\n') + '\nexport default {};', loader: 'js' };
      });
    } }],
  });
  const result = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const [sans, mono] = await Promise.all([readFile('src/app/fonts/InstrumentSans.ttf'), readFile('src/app/fonts/JetBrainsMono.ttf')]);
  const css = `@font-face{font-family:'Instrument Sans';src:url('/sans.ttf');font-weight:400 700;}@font-face{font-family:'JetBrains Mono';src:url('/mono.ttf');font-weight:100 800;}:root{--font-instrument-sans:'Instrument Sans';--font-jetbrains-mono:'JetBrains Mono';}` + result.css;
  const built = { script: bundle.outputFiles![0]!.text, css, sans, mono };
  cache.set(entry, built);
  return built;
}

export async function openApp(page: Page, entry: string, init: { auth?: Record<string, unknown>; path?: string } = {}) {
  const assets = await buildApp(entry);
  await page.addInitScript(() => { (window as any).process = { env: { NODE_ENV: 'test' } }; });
  await page.addInitScript(({ auth }) => {
    (window as any).__auth = { user: { id: 'u1', email: 'ada@example.com', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] }, profile: { id: 'u1', username: 'ada', fullName: 'Ada Lovelace', avatarUrl: null }, isAuthenticated: true, isLoading: false, signOut: async () => {}, ...auth };
  }, { auth: init.auth ?? {} });
  await page.route(origin + '/**', (route: Route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/sans.ttf') return route.fulfill({ contentType: 'font/ttf', body: assets.sans });
    if (p === '/mono.ttf') return route.fulfill({ contentType: 'font/ttf', body: assets.mono });
    if (p === '/app.js') return route.fulfill({ contentType: 'application/javascript', body: assets.script });
    if (p === '/app.css') return route.fulfill({ contentType: 'text/css', body: assets.css });
    if (p.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
    return route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>app</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>' });
  });
  await page.goto(origin + (init.path ?? '/onboarding'));
}
