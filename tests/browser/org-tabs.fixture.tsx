import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssignmentsPanel } from '@/components/organizations/AssignmentsPanel';
import { OrgFilesPanel } from '@/components/organizations/OrgFilesPanel';
import { OrgMembersTab } from '@/components/organizations/OrgMembersTab';
import { OrgProjectsTab } from '@/components/organizations/OrgOverviewParts';
import { SidebarWorkspaces } from '@/components/layout/SidebarWorkspaces';

// The org Tasks, Members, Files and Projects tabs and the sidebar tree (report §31.2 G13, G16), one per ?tab=.
const tab = new URLSearchParams(location.search).get('tab') ?? 'members';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const sidebar = { orgs: [{ id: 'org', title: 'CSE-3A Software Engineering', slug: 'cse-3a', logo: null, needsYou: 3, unseenAnnouncement: true, isAdmin: true, canCreate: true, moreChildren: 0, children: [{ id: 'c1', title: 'Team Falcon', slug: 'falcon' }] }], requested: [], outside: [], personal: [], archived: [] };

createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}>
        <main style={{ padding: 16 }}>
            {tab === 'members' ? <OrgMembersTab orgId="org" /> : null}
            {tab === 'projects' ? <OrgProjectsTab orgId="org" /> : null}
            {tab === 'tasks' ? <AssignmentsPanel orgId="org" /> : null}
            {tab === 'files' ? <><OrgFilesPanel projectId="child" mode="child" canCopy /><OrgFilesPanel projectId="org" mode="org-admin" canCopy={false} /></> : null}
            {tab === 'sidebar' ? <nav style={{ width: 240 }}><SidebarWorkspaces data={sidebar as never} /></nav> : null}
        </main>
    </QueryClientProvider>,
);
