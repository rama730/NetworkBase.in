import React from 'react';
import { createRoot } from 'react-dom/client';
import { SidebarWorkspaces } from '@/components/layout/SidebarWorkspaces';

const org = { logo: null, isAdmin: false, moreChildren: 0, children: [] };
const data = {
    orgs: [
        { ...org, id: 'org', title: 'CSE 3B · Data Structures 2026', slug: 'cse-3b', needsYou: 1, unseenAnnouncement: true, isAdmin: true, canCreate: true, children: [{ id: 'c1', title: 'Team Falcon', slug: 'falcon' }] },
        { ...org, id: 'org2', title: 'Quiet Org', slug: 'quiet', needsYou: 0, unseenAnnouncement: true, canCreate: false },
    ],
    requested: [], outside: [], archived: [],
    personal: [{ id: 'p1', title: 'Ponytail', slug: 'ponytail', logo: null }],
};
const list = <SidebarWorkspaces data={data as never} />;

createRoot(document.getElementById('root')!).render(
    new URLSearchParams(location.search).get('view') === 'collapsed'
        ? <aside className="nb-sidebar" data-collapsed="true" style={{ display: 'flex' }}><div className="nb-sidebar-body">{list}</div></aside>
        : <aside className="nb-sidebar" style={{ display: 'flex' }}><div className="nb-sidebar-body">{list}</div></aside>,
);
