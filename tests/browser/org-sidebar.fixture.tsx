import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SidebarWorkspaces } from '@/components/layout/SidebarWorkspaces';
import { Toaster } from '@/components/ui/sonner';

// Left navigation → Workspaces (docs/superpowers/plans/2026-11-05-sidebar-workspaces-findings.md), the real component
// and stylesheet. ?view=collapsed puts it in the collapsed strip; ?size=long adds rows past the filter's 10.
const params = new URLSearchParams(location.search);
const long = params.get('size') === 'long';
const small = params.get('size') === 'small';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const row = (id: string, title: string, unseen = false) => ({ id, title, slug: id, unseen });
const data = small ? { orgs: [], requested: [], outside: [], archived: [], pinned: [], personal: [row('p0', 'Ponytail'), row('p1', 'Caveman')] } : {
    orgs: [
        {
            id: 'org', title: 'CSE 3B · Data Structures 2026', slug: 'cse-3b', needsYou: 2, unseenAnnouncement: true, isAdmin: true, canCreate: true,
            children: [row('falcon', 'Team Falcon: Hash table library', true), row('osprey', 'Team Osprey'), row('kestrel', 'Team Kestrel'), row('heron', 'Team Heron'), row('wren', 'Team Wren'), row('lark', 'Team Lark'), row('owl', 'Team Owl')],
        },
        { id: 'org2', title: 'Quiet Org', slug: 'quiet', needsYou: 0, unseenAnnouncement: true, isAdmin: false, canCreate: false, children: [] },
    ],
    requested: [{ id: 'req', title: 'Robotics Club', slug: 'robotics' }],
    outside: [{ ...row('out', 'Parser Lab'), orgTitle: 'CSE 3A' }],
    personal: long ? Array.from({ length: 15 }, (_, i) => row(`p${i}`, i === 0 ? 'Ponytail' : `Side project ${i}`, i === 2)) : [row('p0', 'Ponytail'), row('p1', 'Caveman', true)],
    archived: [{ id: 'old', title: 'Old Lab', slug: 'old', kind: 'workspace' }],
    pinned: params.get('pinned') ? ['p1'] : [],
};

createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}>
        {params.get('view') === 'collapsed'
            // The same wrapper as AppSidebar's SidebarNav: a block container, where a <button> doesn't stretch by itself.
            ? <aside className="nb-sidebar" data-collapsed="true" style={{ display: 'flex' }}><div className="nb-sidebar-body"><div className="nb-sidebar-scroll space-y-3">
                <nav className="space-y-1"><a href="/discover" className="nb-nav-link" aria-label="Discover"><svg width="16" height="16" aria-hidden="true" /><span className="nb-sidebar-label">Discover</span></a></nav>
                <button type="button" className="nb-nav-link nb-sidebar-workspaces-rail" aria-label="Workspaces"><svg width="16" height="16" aria-hidden="true" /></button>
                <section className="nb-sidebar-workspace"><SidebarWorkspaces data={data as never} /></section>
            </div></div></aside>
            : <aside className="nb-sidebar" style={{ display: 'flex' }}><div className="nb-sidebar-body">
                <button type="button" className="nb-nav-link nb-sidebar-workspaces-rail" aria-label="Workspaces">W</button>
                <section className="nb-sidebar-workspace"><SidebarWorkspaces data={data as never} /></section>
            </div></aside>}
        <Toaster />
    </QueryClientProvider>,
);
