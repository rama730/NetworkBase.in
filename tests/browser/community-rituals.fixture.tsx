import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { CommunityRituals } from '@/components/organizations/CommunityRituals';

// Plan B5.4d (report 34.5): Sprints → Rituals.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }}>
      <CommunityRituals orgId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" me="00000000-0000-4000-8000-000000000001" />
    </main>
    <Toaster />
  </QueryClientProvider>,
);
