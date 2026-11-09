import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssignmentComposer, AssignmentFields, AssignmentManageSection, ReviewQueue } from '@/components/organizations/AssignmentsPanel';
import CreateTaskModal from '@/components/workspaces/v2/tasks/CreateTaskModal';
import { OrgFilesCollection, OrgStorageNotice } from '@/components/organizations/OrgFilesPanel';
import { OrgMembersTab } from '@/components/organizations/OrgMembersTab';
import { FormProvider, useForm } from 'react-hook-form';
import { ChildLeadAndUnassigned, InheritedAdminRows, UnitPeople } from '@/components/organizations/ChildTeamFields';
import { ChildUnitsPanel } from '@/components/organizations/ChildUnitsPanel';
import { CreateLocationProvider } from '@/components/organizations/CreateLocation';
import WorkspaceLayout from '@/components/workspaces/dashboard/WorkspaceLayout';
import CreateSprintModal from '@/components/workspaces/v2/sprints/CreateSprintModal';
import { OrgWorkSection } from '@/components/organizations/OrgSettingsSections';
import { OrgNewItems, OrgNewMenu } from '@/components/organizations/OrgHeaderParts';
import { WorkspaceUpdateComposer } from '@/components/workspaces/updates/WorkspaceUpdateComposer';

// The org Tasks, Members and Files tabs (Workspaces has its own: org-workspaces.spec.ts) and the sidebar tree (report §31.2 G13, G16), one per ?tab=.
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

// The sprint form (report §16.2, §18.2, §28.2): Repeat on an organization, and a team sprint inside Unit 1.
const done = async () => ({ success: true });
function SprintForm({ kind }: { kind: 'org' | 'child' }) {
    const co1 = { id: 'co1', name: 'Unit 1', status: 'active', startDate: '2027-01-04T00:00:00.000Z', endDate: '2027-01-17T00:00:00.000Z' };
    return kind === 'org' ? (
        <CreateSprintModal projectId="org" isOpen mode="create" onClose={() => undefined} onSubmit={done} onRepeat={done}
            org={{ kind: 'org', orgTitle: 'CSE-3A', orgSprints: [], orgType: 'education', termEnd: '2027-02-20' }}
            existingSprints={[{ id: 's1', name: 'Unit 1', startDate: '2026-12-01T00:00:00.000Z', endDate: '2026-12-14T00:00:00.000Z', status: 'completed' },
                { id: 'b', name: 'Mid-term break', startDate: '2027-01-20T00:00:00.000Z', endDate: '2027-01-24T00:00:00.000Z', status: 'planning' }]} />
    ) : (
        <CreateSprintModal projectId="child" isOpen mode="create" onClose={() => undefined} onSubmit={done}
            org={{ kind: 'child', orgTitle: 'CSE-3A', orgSprints: [co1], followsOrgSprints: true, groupBacklog: 2, words: { main: 'Unit', inner: 'Week', plan: 'Term', isClass: true } }} existingSprints={[]} />
    );
}

createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}>
        <main style={{ padding: 16 }}>
            {tab === 'members' ? <OrgMembersTab orgId="org" /> : null}
            {/* One board (live-fix 3): In review's queue, and a card's assignment panel (published, then a draft). */}
            {tab === 'tasks' ? <><ReviewQueue orgId="org" onChanged={() => undefined} /><h2>Lab 3 — Consensus protocols</h2><AssignmentManageSection orgId="org" masterId="a1" /></> : null}
            {tab === 'tasks-draft' ? <><h2>Reading quiz</h2><AssignmentManageSection orgId="org" masterId="a2" /></> : null}
            {/* Live-fix 28: the right column is ~380px at 1280; the org toolbar used to push Post past its edge. */}
            {tab === 'composer' ? <div data-testid="composer-column" style={{ maxWidth: 380 }}><WorkspaceUpdateComposer projectId="org" projectName="CSE-3A" currentUserId="u1" canCreate canManage isPosting={false} defaultPlaceholder="Share with CSE-3A…"
                orgControls={{ top: null, postLabel: 'Post to 40 people', blockedReason: null, visibility: 'members', placeholder: 'Share with CSE-3A…',
                    toolbar: <>{['Pin', 'Also email · 5 of 5 left today', '#general'].map((t) => <button key={t} type="button" className="inline-flex min-h-8 items-center rounded-[5px] border border-border px-2.5 text-[12px]">{t}</button>)}</> }}
                onPost={async () => true} /></div> : null}
            {tab === 'compose' ? <AssignmentComposer orgId="org" open onOpenChange={() => undefined} onCreated={() => undefined} /> : null}
            {/* Board/review report §4: New with Task and Assignment tabs, as an organization's board opens it. */}
            {tab === 'new' || tab === 'new-assignment' ? <CreateTaskModal isOpen projectId="org" onClose={() => undefined} onCreate={async () => ({ success: true })} canAssignSprint
                members={[{ id: 'u1', fullName: 'Ravi Kumar' }]} sprints={[{ id: 's1', name: 'CO1', status: 'active' }]} initialKind={tab === 'new-assignment' ? 'assignment' : 'task'}
                renderMany={({ choice, title, description, sprintId, onDraft, onDone }) => <AssignmentFields orgId="org" prefill={{ title, description, mode: choice as never, sprintId }} onDraft={onDraft} onDone={onDone} onCreated={() => undefined} />} /> : null}
            {tab === 'files' ? <><OrgStorageNotice org={{ mode: 'org', orgId: 'org', title: 'CSE-3A', slug: 'cse-3a', isAdmin: true, canCopy: false }} /><OrgFilesCollection view="from_org" projectId="child" org={{ mode: 'child', orgId: 'org', title: 'CSE-3A Software Engineering', slug: 'cse-3a', isAdmin: false, canCopy: true }} /></> : null}
            {tab === 'team' ? <Team /> : null}
            {tab === 'units' ? <ChildUnitsPanel projectId="child" /> : null}
            {tab === 'header' ? <Header /> : null}
            {tab === 'sprint-org' ? <SprintForm kind="org" /> : null}
            {tab === 'sprint-child' ? <SprintForm kind="child" /> : null}
            {/* Sprint redesign (2026-11-09): Settings → Work names the main sprint and renames old names once. */}
            {tab === 'work' ? <OrgWorkSection orgId="org" organization={{ type: 'education', changes: {}, timeZone: null, work: { reviewRequired: true, lateRule: 'until', reminders: 'both', storyPoints: 'hidden', dueTime: '23:59', mainSprintWord: null,
                sprintAutoStart: true, sprintNotifyOnStart: true, sprintShowInChildren: true, sprintCreateMatching: false } } as never} /> : null}
        </main>
    </QueryClientProvider>,
);
