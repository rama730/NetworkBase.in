import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { PlannerTimeline } from '@/components/workspaces/v2/tasks/PlannerTimeline';

// Report 38.5 W2, W4 (plan A1.4): the Projects Timeline.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: () => undefined };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="p-6">
      <PlannerTimeline projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" canEdit={!w.__readOnly} viewerId="u1"
        sprints={[{ id: 's1', name: 'Sprint 7', status: 'active', startDate: '2026-11-16T00:00:00.000Z', endDate: '2026-11-29T00:00:00.000Z' }]}
        onOpen={(id) => { w.__opened = id; }} onMoreDetails={(d) => { w.__more = d; }} />
    </main>
    <Toaster />
  </QueryClientProvider>,
);
