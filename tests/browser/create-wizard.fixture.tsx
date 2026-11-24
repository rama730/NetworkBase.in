import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import CreateWorkspaceWizard from '@/components/workspaces/create-wizard/CreateWorkspaceWizard';
import { OrganizationCreatedScreen } from '@/components/organizations/OrganizationCreatedScreen';
import { CreateWorkspaceCell } from '@/components/layout/header/CreateWorkspaceCell';

// The real create wizard (v6) in a real browser with the app's stylesheet. Server actions answer from window.__actions;
// window.__calls records them; window.__router records navigation. ?org=1 gives the person one organization.
const w = window as any;
const params = new URLSearchParams(location.search);
let route = location.pathname;
const subs = new Set<() => void>();
w.__pushed = [] as string[];
w.__replaced = [] as string[];
w.__calls = [] as Array<{ name: string; args: unknown[] }>;
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => route, push: (href: string) => { w.__pushed.push(href); route = href.split('?')[0]!; subs.forEach((f) => f()); } };
const record = (name: string, value: unknown) => (...args: unknown[]) => { w.__calls.push({ name, args }); return Promise.resolve(typeof value === 'function' ? (value as (...a: unknown[]) => unknown)(...args) : value); };
w.__actions = {
    readOrgCreationLimitAction: record('readOrgCreationLimitAction', { block: null }),
    checkOrgHandleAction: record('checkOrgHandleAction', (h: string) => ({ available: true, message: 'Available', handle: h })),
    createWorkspaceAction: record('createWorkspaceAction', { success: true, project: { id: 'p1', title: 'Garden Map', slug: 'garden-map' } }),
    ...(w.__extraActions ?? {}),
};
// ?org=class gives a class (education: roles show no pay) instead of the club.
const locations = params.get('org') === 'class'
    ? [{ id: 'o1', title: 'CSE-3A', slug: 'cse-3a', orgType: 'education', visibilityCap: 'public', orgPublic: true, isAdmin: true }]
    : params.get('org') ? [{ id: 'o1', title: 'Riverside Robotics Club', slug: 'riverside', orgType: 'club', visibilityCap: 'public', orgPublic: true, isAdmin: true }] : [];

function App() {
    const current = useSyncExternalStore(w.__router.subscribe, w.__router.get);
    // /away: the person left the page (the wizard unmounts).
    if (current === '/away') return null;
    // ?orgdone=1: the organization's ready screen, as the create page shows it after Create.
    if (params.get('orgdone')) {
        return <OrganizationCreatedScreen title="Riverside Robotics Club" joinCode="RIV-7K2" handle="riverside" invites={{ coAdmins: 1, members: 3, skipped: 0 }} joinMode="instant" onContinue={() => w.__replaced.push('/org/riverside')} />;
    }
    // ?topbar=1: the app's top bar cell above the wizard, as /workspaces/new shows it.
    const topbar = params.get('topbar') ? <div className="nb-topbar-cells flex h-14 justify-end border-b border-border bg-card"><CreateWorkspaceCell active /></div> : null;
    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
            {topbar}
            <div style={{ flex: 1, minHeight: 0 }}>
            <CreateWorkspaceWizard onClose={() => w.__router.push('/closed')} onSuccess={(id: string) => w.__router.push(`/created/${id}`)}
                onOpen={(f: { projectId: string; slug: string | null }) => w.__replaced.push(`/workspaces/${f.slug ?? f.projectId}`)}
                createLocations={locations as never} initialOrgId={params.get('locked') ? 'o1' : null} initialSource={(params.get('source') as never) ?? null} />
            </div>
        </div>
    );
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><TooltipProvider><App /></TooltipProvider></QueryClientProvider>);
