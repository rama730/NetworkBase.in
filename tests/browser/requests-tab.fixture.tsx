import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { RequestsTab } from "@/components/workspaces/workflows/RequestsTab";

// Report 38.7 T4 (plan A2.4): the Requests tab.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: () => undefined };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const members = [{ userId: 'u1', role: 'owner', user: { id: 'u1', fullName: 'Asha', username: 'asha' } }, { userId: 'u2', role: 'member', user: { id: 'u2', fullName: 'Dev', username: 'dev' } }];
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="p-6">
      <RequestsTab projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" projectSlug="acme" projectName="Acme" currentUserId="u1" members={members} sprints={[]} canPlanSprints />
    </main>
    <Toaster />
  </QueryClientProvider>,
);
