import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { Changelog } from "@/components/workspaces/updates/Changelog";
import { ScheduledUpdates } from "@/components/workspaces/updates/ScheduledUpdates";

// Report 38.17 W2, W5, W6 (plan A7.4, A7.5): the Scheduled list and the Changelog.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view') ?? 'scheduled';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const P = "5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="max-w-2xl p-6">{view === 'changelog' ? <Changelog projectId={P} /> : <ScheduledUpdates projectId={P} onPosted={() => { w.__posted = true; }} />}</main>
    <Toaster />
  </QueryClientProvider>,
);
