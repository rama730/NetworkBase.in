import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import CreateWorkspaceWizard from '@/components/workspaces/create-wizard/CreateWorkspaceWizard';

// The real create wizard (v6) in a real browser with the app's stylesheet. Server actions answer from window.__actions;
// window.__calls records them; window.__router records navigation. ?org=1 gives the person one organization.
const w = window as any;
const params = new URLSearchParams(location.search);
let route = location.pathname;
const subs = new Set<() => void>();
w.__pushed = [] as string[];
w.__calls = [] as Array<{ name: string; args: unknown[] }>;
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => route, push: (href: string) => { w.__pushed.push(href); route = href.split('?')[0]!; subs.forEach((f) => f()); } };
const record = (name: string, value: unknown) => (...args: unknown[]) => { w.__calls.push({ name, args }); return Promise.resolve(typeof value === 'function' ? (value as (...a: unknown[]) => unknown)(...args) : value); };
w.__actions = {
    readOrgCreationLimitAction: record('readOrgCreationLimitAction', { block: null }),
    checkOrgHandleAction: record('checkOrgHandleAction', (h: string) => ({ available: true, message: 'Available', handle: h })),
    createWorkspaceAction: record('createWorkspaceAction', { success: true, project: { id: 'p1', title: 'Garden Map', slug: 'garden-map' } }),
    ...(w.__extraActions ?? {}),
};
const locations = params.get('org') ? [{ id: 'o1', title: 'Riverside Robotics Club', slug: 'riverside', orgType: 'club', visibilityCap: 'public', orgPublic: true, isAdmin: true }] : [];

function App() {
    useSyncExternalStore(w.__router.subscribe, w.__router.get);
    return (
        <div style={{ height: '100vh' }}>
            <CreateWorkspaceWizard onClose={() => w.__router.push('/closed')} onSuccess={(id: string) => w.__router.push(`/created/${id}`)} createLocations={locations as never} initialOrgId={params.get('locked') ? 'o1' : null} />
        </div>
    );
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><TooltipProvider><App /></TooltipProvider></QueryClientProvider>);
