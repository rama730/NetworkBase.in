import { readFile } from 'node:fs/promises';
import type { Plugin } from 'esbuild';

// Next compiles a "use server" file into remote calls, so its imports never reach the browser. Fixtures need the same
// boundary, or every action the app adds drags the database and Node modules into the bundle. A spec's own mocks win:
// list this plugin last, and they resolve first. An action nobody mocked answers like a refused request.
export const exportedNames = (source: string) => {
  const names = new Set([...source.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]!));
  for (const list of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of list[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  names.delete('default');
  return [...names];
};

// Next's runtime modules read server state on import. A fixture has no server, so it gets these unless it brings its own.
const NEXT_SHIMS: Record<string, string> = {
  'next/navigation': `const router={push(){},replace(){},refresh(){},prefetch(){},back(){},forward(){}};
    export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useParams=()=>({});
    export const useSearchParams=()=>new URLSearchParams(location.search);
    export const redirect=()=>{throw new Error('redirect');};export const notFound=()=>{throw new Error('notFound');};`,
  'next/cache': `export const revalidatePath=()=>{};export const revalidateTag=()=>{};export const unstable_cache=(f)=>f;`,
  'next/headers': `export const cookies=async()=>({get(){},set(){},delete(){}});export const headers=async()=>new Headers();`,
  'next/server': `export const after=()=>{};export const NextResponse=class{};export const NextRequest=class{};`,
  'next/og': `export const ImageResponse=class{};`,
  '@sentry/nextjs': `const none=()=>{};export const captureException=none;export const captureMessage=none;export const captureRouterTransitionStart=none;export const init=none;export const setUser=none;export const setTag=none;export const withScope=(f)=>f({setTag:none,setExtra:none,setContext:none,setLevel:none});`,
  'server-only': `export {};`,
};

export const serverActionsPlugin: Plugin = {
  name: 'server-actions',
  setup(build) {
    build.initialOptions.loader = { ...build.initialOptions.loader, '.css': 'empty' };
    // Next inlines process.env at build time; here anything not defined reads from an empty environment.
    build.initialOptions.banner = { js: `globalThis.process ??= { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture' } };` };
    build.onResolve({ filter: /^(next\/(navigation|cache|headers|server|og)|@sentry\/nextjs|server-only)$/ }, (args) => ({ path: args.path, namespace: 'next-shim' }));
    build.onLoad({ filter: /.*/, namespace: 'next-shim' }, (args) => ({ contents: NEXT_SHIMS[args.path], loader: 'js' }));
    build.onLoad({ filter: /src\/.*\.tsx?$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      if (!/^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*['"]use server['"]/.test(source)) return undefined;
      const stubs = exportedNames(source).map((name) => `export const ${name} = async (...args) => {
        const mock = window.__actions && window.__actions.${name};
        return mock ? mock(...args) : { success: false, error: 'Not available in this fixture' };
      };`);
      return { contents: `${stubs.join('\n')}\nexport default {};`, loader: 'js' };
    });
  },
};
