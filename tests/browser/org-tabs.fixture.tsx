import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssignmentsPanel } from '@/components/organizations/AssignmentsPanel';
import { OrgFilesCollection, OrgStorageNotice } from '@/components/organizations/OrgFilesPanel';
import { OrgMembersTab } from '@/components/organizations/OrgMembersTab';
import { OrgWorkspacesTab } from '@/components/organizations/OrgOverviewParts';
import { FormProvider, useForm } from 'react-hook-form';
import { ChildLeadAndUnassigned, InheritedAdminRows, UnitPeople } from '@/components/organizations/ChildTeamFields';
import { ChildUnitsPanel } from '@/components/organizations/ChildUnitsPanel';
import { CreateLocationProvider } from '@/components/organizations/CreateLocation';
import WorkspaceLayout from '@/components/workspaces/dashboard/WorkspaceLayout';
import { OrgNewItems, OrgNewMenu } from '@/components/organizations/OrgHeaderParts';

// The org Tasks, Members, Files and Projects tabs and the sidebar tree (report §31.2 G13, G16), one per ?tab=.
const tab = new URLSearchParams(location.search).get('tab') ?? 'members';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

// Phase 3 of the create wizard for a child project (report §14.4), as an admin in an org that allows outside people.
const orgLocation = { id: 'org', title: 'CSE-3A', slug: 'cse-3a', block: null, visibilityCap: 'public', orgPublic: true, isAdmin: true, orgType: 'education', outsidePeople: true };
function Team() {
    const methods = useForm({ defaultValues: { parent_org_id: 'org', roles: [{ role: 'Frontend developers', count: 3, people: [{ user_id: 'u1', label: 'Ravi Kumar' }, { user_id: 'u2', label: 'Asha Nair' }] }, { role: 'Testing', count: 1, people: [] }], unassigned_people: [] } as never });
    return (
        <FormProvider {...methods}>
            <CreateLocationProvider value={{ locations: [orgLocation], locked: true, notice: null }}>
                <UnitPeople index={0} unitName="Frontend developers" />
                <ChildLeadAndUnassigned />
                <InheritedAdminRows />
            </CreateLocationProvider>
        </FormProvider>
    );
}

// The org header (report §18): + New ▾, tab badges and, on Tasks, the compact bar with the active sprint chip.
function Header() {
    const [active, setActive] = React.useState(new URLSearchParams(location.search).get('active') ?? 'dashboard');
    const [picked, setPicked] = React.useState<string | null>(null);
    const project = { id: 'org', title: 'CSE-3A 2026', slug: 'cse-3a', visibility: 'org', status: 'active', tags: [], links: [] } as never;
    return (
        <WorkspaceLayout project={project} isOwner isOwnerOrMember canManageSettings isOrganization activeTab={active} onTabChange={setActive}
            tabBadges={{ tasks: 5, updates: 'dot', members: 2 }} compactChip={<span className="nb-status shrink-0" data-status="active">CO1</span>}
            compactMenuItems={<OrgNewItems onNew={setPicked} prefix="New " />} actionsStart={<OrgNewMenu onNew={setPicked} />} showFollow={false}>
            <p data-testid="picked">{picked ?? 'none'}</p>
        </WorkspaceLayout>
    );
}

createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}>
        <main style={{ padding: 16 }}>
            {tab === 'members' ? <OrgMembersTab orgId="org" /> : null}
            {tab === 'projects' ? <OrgWorkspacesTab orgId="org" /> : null}
            {tab === 'tasks' ? <AssignmentsPanel orgId="org" /> : null}
            {tab === 'files' ? <><OrgStorageNotice org={{ mode: 'org', orgId: 'org', title: 'CSE-3A', slug: 'cse-3a', isAdmin: true, canCopy: false }} /><OrgFilesCollection view="from_org" projectId="child" org={{ mode: 'child', orgId: 'org', title: 'CSE-3A Software Engineering', slug: 'cse-3a', isAdmin: false, canCopy: true }} /></> : null}
            {tab === 'team' ? <Team /> : null}
            {tab === 'units' ? <ChildUnitsPanel projectId="child" /> : null}
            {tab === 'header' ? <Header /> : null}
        </main>
    </QueryClientProvider>,
);
