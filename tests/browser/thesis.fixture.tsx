import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { ThesisOverviewCard } from '@/components/workspaces/dashboard/ThesisOverviewCard';
import { AddedWorkflowsContext } from '@/components/workspaces/workflows/useWorkspaceWorkflows';

// Report 30.6 W5 (plan B1.8a): the thesis on Overview.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <AddedWorkflowsContext.Provider value={['thesis']}>
      <main style={{ maxWidth: 360, margin: '24px auto' }}><ThesisOverviewCard projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" slug="gnn" /></main>
    </AddedWorkflowsContext.Provider>
    <Toaster />
  </QueryClientProvider>,
);
