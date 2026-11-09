import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignInFlightHost, preloadSignInFlight } from '@/components/auth/SignInFlight';
import { MainLayout } from '@/components/layout/MainLayout';
import { DiscoverRouteSkeleton } from '@/components/discover/DiscoverRouteSkeleton';
import { buildSignInCurtainScript } from '@/lib/auth/signin-flight';

// The pieces of the real app that matter to the sign-in flight: the real sign-in form, the real overlay and host, and
// the real app shell, with a router the test can slow down. A full page load is a fresh page that starts on
// /discover with the marker already in session storage; the curtain script runs first, as it does in the real head.
const w = window as any;
let route = location.pathname;
const subs = new Set<() => void>();
w.__pushed = [] as string[];
w.__router = {
  subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); },
  get: () => route,
  push: (href: string) => {
    w.__pushed.push(href);
    setTimeout(() => { route = href.split('?')[0]!; subs.forEach((f) => f()); }, w.__navDelay ?? 300);
  },
};
w.__flightCalls = [] as unknown[];
const identity = () => ({ full_name: w.__fullName ?? 'Ada Lovelace', username: 'ada', avatar_url: w.__avatarUrl ?? '', visibility: w.__visibility ?? 'public' });
const session = { access_token: 'a', refresh_token: 'r', user: { id: 'u1', app_metadata: {} } };
const supabase = () => ({
  auth: {
    getSession: async () => ({ data: { session: w.__signedOut ? null : session } }),
    signInWithPassword: async ({ password }: { password: string }) => (password === 'wrong'
      ? { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } }
      : { data: { user: { id: 'u1' }, session }, error: null }),
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } }) },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: identity() }) }) }) }),
});
w.__actions = {
  readSidebarWorkspacesAction: () => Promise.resolve({ orgs: [], requested: [], outside: [], personal: [], archived: [] }),
  recordSignInFlight: (input: unknown) => { w.__flightCalls.push(input); return Promise.resolve({ success: true }); },
  getMyPresenceSettings: () => Promise.resolve({ success: true, settings: { showActivity: true, visibility: 'network', status: w.__status ?? null } }),
  createClient: supabase,
  createSupabaseBrowserClient: supabase,
};

// What the real head does before the first paint.
if (!w.__noCurtain) new Function(buildSignInCurtainScript())();

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Content() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => { w.__contentAt = performance.now(); setReady(true); }, w.__contentDelay ?? 0);
    return () => clearTimeout(id);
  }, []);
  return ready ? <div className="p-6">Discover content</div> : <DiscoverRouteSkeleton />;
}

function Page() {
  const path = useSyncExternalStore(w.__router.subscribe, w.__router.get);
  if (path.startsWith('/login')) return <LoginForm redirect={new URLSearchParams(location.search).get('redirect')} error={null} step={null} />;
  if (path.startsWith('/onboarding')) return <main className="p-6">Onboarding</main>;
  if (path.startsWith('/legal')) return <main className="p-6">Legal</main>;
  return <MainLayout><Content /></MainLayout>;
}

preloadSignInFlight().then(() => {
  createRoot(document.getElementById('root')!).render(
    <ThemeProvider><QueryClientProvider client={client}><TooltipProvider><Page /></TooltipProvider></QueryClientProvider><SignInFlightHost /></ThemeProvider>,
  );
});
