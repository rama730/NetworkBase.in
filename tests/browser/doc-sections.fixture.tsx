import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { MoveToSectionMenu } from '@/components/workspaces/doc/MoveToSectionMenu';
import { WorkspaceDocMobileBar, WorkspaceDocRail } from '@/components/workspaces/doc/WorkspaceDocRail';
import { AddedWorkflowsContext } from '@/components/workspaces/workflows/useWorkspaceWorkflows';

// Report 38.3 F2 S1, S2, W1, W2, W11 (plan A0.4): the Documents rail with sections, the phone Section menu and Move to
// section. Server actions answer from window.__actions; ?added= lists the workspace's workflows.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: () => undefined };
const added = (new URLSearchParams(location.search).get('added') ?? '').split(',').filter(Boolean);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <AddedWorkflowsContext.Provider value={added}>
      <main className="mx-auto grid max-w-5xl gap-8 p-6 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <WorkspaceDocMobileBar projectId="w1" activeSlug="plan" canEdit />
          <div className="flex justify-end"><MoveToSectionMenu projectId="w1" docSlug="plan" current="pages" /></div>
          <h1 className="nb-section-title">Plan</h1>
        </div>
        <WorkspaceDocRail projectId="w1" activeSlug="plan" canEdit />
      </main>
    </AddedWorkflowsContext.Provider>
    <Toaster />
  </QueryClientProvider>,
);
