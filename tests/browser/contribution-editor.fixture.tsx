import React from 'react';
import { createRoot } from 'react-dom/client';
import { ContributionEditor } from '@/components/profile/edit/ContributionEditor';
import { contributionToEditorEntry } from '@/lib/profile/contribution-editor';

// Live-fix phase 7: an organization's entry (a draft), with its team workspace nested under it.
const base = {
    repoUrl: null, description: null, endDate: null, currentlyActive: true, skills: [], verified: true, visibility: 'public',
    roleStages: [], presentation: null, publishedAt: null, version: 1, source: 'membership', projectHref: '/org/cse-3b',
};
const org = { ...base, id: 'e1', projectId: 'org', projectKind: 'organization', projectTitle: 'CSE 3B · Data Structures 2026', title: 'Teacher · Course Instructor',
    startDate: '2026-10-31', orgVerified: true, verifiedByName: 'Ms. Rao', verifiedAt: '2026-11-02T10:00:00.000Z', projectCoverImage: null, parentOrg: null,
    description: 'Ran the labs with {% ref.person id="u1" %} \\\\ and *reviews*.', resolvedReferences: [{ kind: 'person', id: 'u1', label: 'Lakshmi CH', href: null, available: true }] };
const team = { ...base, id: 'e2', projectId: 'team', projectKind: 'project', projectTitle: 'Team Falcon', title: 'Team lead', startDate: '2026-10-31',
    parentOrg: { id: 'org', title: 'CSE 3B · Data Structures 2026', slug: 'cse-3b' } };

createRoot(document.getElementById('root')!).render(
    <main style={{ padding: 16 }}>
        <ContributionEditor items={[org, team].map((c) => contributionToEditorEntry(c as never))} profileId="me" profileVisibility="public" />
    </main>,
);
