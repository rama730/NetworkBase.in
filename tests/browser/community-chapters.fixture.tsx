import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { CommunityChapters, CommunityGroups } from '@/components/organizations/CommunityChapters';
import { GroupPolls } from '@/components/organizations/GroupPolls';

// Plan B5.5a (report 34.6): Workspaces → Chapters.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }}>{new URLSearchParams(window.location.search).get('view') === 'polls' ? <GroupPolls groupId="6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" /> : new URLSearchParams(window.location.search).get('view') === 'groups' ? <CommunityGroups orgId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" /> : <CommunityChapters orgId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" />}</main>
    <Toaster />
  </QueryClientProvider>,
);
