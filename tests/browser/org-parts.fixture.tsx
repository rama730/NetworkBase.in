import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { OrgPartsSettings } from '@/components/organizations/OrgParts';
import { BoardMeetingsCard } from '@/components/organizations/BoardMeetings';
import { CommunityProjects } from '@/components/organizations/CommunityChapters';

// Plan B8.4a (report 37.2): Settings → Workflows.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }} className="space-y-4"><OrgPartsSettings orgId="aa1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" /><BoardMeetingsCard orgId="aa1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" base="/org/wt" />{w.__groups ? <CommunityProjects club label="Groups" orgId="aa1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" list={<p>The list</p>} /> : null}</main>
    <Toaster />
  </QueryClientProvider>,
);
