import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkspaceLayout from '@/components/workspaces/dashboard/WorkspaceLayout';
import { OrgHeaderDetails } from '@/components/organizations/OrgHeaderParts';

const view = new URLSearchParams(location.search).get('view');
const id = '11111111-1111-4111-8111-111111111111';
const owner = { id: 'o1', fullName: 'Ramanayudu CH', username: 'rama', avatarUrl: null };
const base = { id, slug: 'deepscope-ai', status: 'active', visibility: 'public', owner, tags: [], links: [] };
const org = { partOf: 'Northgate Institute of Technology and Advanced Research', location: 'Bengaluru', typeLabel: 'Education', termStart: null, termEnd: null, memberCount: 40 };
const projects: Record<string, unknown> = {
    image: { ...base, title: 'DeepScope AI', shortDescription: 'See Beyond the Surface of Any Website.', coverImage: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' },
    empty: { ...base, title: 'Ponytail', shortDescription: 'The laziest solution that works.' },
    org: { ...base, title: 'CSE 3B · Data Structures 2026', shortDescription: 'Data Structures for 3rd-semester CSE, Section B', organization: org },
};
const isOwner = view !== 'visitor';
const project = projects[view === 'visitor' ? 'empty' : view ?? 'image'] as never;

createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={new QueryClient()}>
        <WorkspaceLayout project={project} isOwner={isOwner} isOwnerOrMember={isOwner} canManageSettings={false} activeTab="dashboard" onTabChange={() => undefined} viewCount={975} followersCount={1}
            canInvite onInvite={() => undefined} isOrganization={view === 'org'}
            metadataExtra={view === 'org' ? <span className="nb-compact text-muted-foreground">· 3 workspaces</span> : null}
            headerDetails={view === 'org' ? <OrgHeaderDetails organization={org as never} /> : null}>
            <p>Tab content</p>
        </WorkspaceLayout>
    </QueryClientProvider>,
);
