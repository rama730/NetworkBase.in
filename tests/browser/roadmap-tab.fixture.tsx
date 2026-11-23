import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { RoadmapTab } from "@/components/workspaces/workflows/RoadmapTab";
import { RoadmapPanelSection } from "@/components/workspaces/v2/tasks/RoadmapParts";

// Report 38.9 T2 (plan A2.10): the Roadmap tab.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: () => undefined };
const panel = new URLSearchParams(window.location.search).get('panel');
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const members = [{ userId: 'u1', role: 'owner', user: { id: 'u1', fullName: 'Asha', username: 'asha' } }];
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="p-6">
      {panel ? <div className="max-w-xl" data-testid="panel-host"><RoadmapPanelSection projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" taskId={panel} /></div>
        : <RoadmapTab projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" projectSlug="acme" projectName="Acme" currentUserId="u1" members={members} sprints={[]} canPlanSprints />}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
