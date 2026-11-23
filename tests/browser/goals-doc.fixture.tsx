import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { GoalsBlock, NewGoalsDialog } from "@/components/workspaces/doc/DocGoals";

// Report 38.12 D3 (plan A5.1a): the goals block and Set goals. Server actions answer from window.__actions.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view');
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const P = "5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="max-w-3xl p-6">
      {view === 'new' ? <NewGoalsDialog projectId={P} open onOpenChange={() => undefined} /> : <GoalsBlock projectId={P} docSlug="goals-2027-q1" />}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
