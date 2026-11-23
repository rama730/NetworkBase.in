import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { LaunchHeader, NewLaunchDialog } from "@/components/workspaces/doc/DocLaunch";
import { AddedWorkflowsContext } from "@/components/workspaces/workflows/added-workflows";

// Report 38.10 D2 (plan A3.1): the launch header and the New launch sheet.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const sheet = new URLSearchParams(window.location.search).get('sheet');
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <AddedWorkflowsContext.Provider value={['roadmap', 'launches']}>
      <main className="max-w-3xl p-6">
        {sheet ? <NewLaunchDialog projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" open onOpenChange={() => undefined} />
          : <LaunchHeader projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" docSlug="v2-4" />}
      </main>
    </AddedWorkflowsContext.Provider>
    <Toaster />
  </QueryClientProvider>,
);
