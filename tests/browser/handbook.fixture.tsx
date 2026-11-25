import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { HandbookSettings, OrgDocChips, OrgDocHeader } from '@/components/organizations/OrgDocParts';

// Plan B4.1a (report 33.2 call 3): the page header's Owner · Review by, Needs review and Still correct; Settings → Handbook.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view') ?? 'page';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const O = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
const doc = { id: 'd1', slug: 'travel-policy', filename: 'Travel policy.md', group: 'policies', required: true, template: false, showInChildren: true, readVersion: 1, lifecycle: 'published', publishedAt: '2026-05-01T00:00:00Z',
  owner: 'u-me', reviewBy: '2026-11-01', label: null, sprint: null, sprintId: null, state: 'published', readers: null, needsReview: view !== 'process', ownerName: 'Priya Shah', ownerGone: false, kind: view === 'process' ? 'process' : null } as const;
const data = { mode: 'org', orgId: O, orgTitle: 'Acme', orgSlug: 'acme', isAdmin: view === 'settings', isInside: true, memberCount: 80, signedIn: true,
  groups: [{ id: 'overview', name: 'Overview' }, { id: 'how', name: 'How we work' }, { id: 'people', name: 'People' }, { id: 'policies', name: 'Policies' }],
  docs: [doc], sprints: [], viewerId: 'u-me', orgType: 'company', canRun: true, reviewMonths: 12, people: [] } as const;
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }}>
      {view === 'settings' ? <HandbookSettings orgId={O} /> : <>
        <OrgDocHeader data={data as any} doc={doc as any} updatedBy="Priya Shah" updatedAt="2026-05-01T00:00:00Z" editHref={null} onRemove={null} visibility="members_only" />
        <p data-testid="chips"><OrgDocChips item={doc as any} /></p>
      </>}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
