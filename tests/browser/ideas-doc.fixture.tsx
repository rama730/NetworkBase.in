import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { IdeasBlock } from "@/components/workspaces/doc/DocIdeas";

// Report 38.13 D4 (plan A5.3): the ranked ideas block. Server actions answer from window.__actions.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="max-w-4xl p-6"><IdeasBlock projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" docSlug="ideas" /></main>
    <Toaster />
  </QueryClientProvider>,
);
