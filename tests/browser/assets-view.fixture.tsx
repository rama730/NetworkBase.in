import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { AssetsCollection } from "@/components/workspaces/v2/files-tab/AssetsCollection";

// Report 38.16 W1, W2, W6, W9 (plan A7.1): Files → Assets.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <div className="flex h-[860px] flex-col"><AssetsCollection projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" /></div>
    <Toaster />
  </QueryClientProvider>,
);
