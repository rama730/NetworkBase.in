import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { FixedTimeCard } from '@/components/organizations/FixedTime';

// Plan B8.2a (report 37.4): the Dates card.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }} className="space-y-4">
      <FixedTimeCard orgId="8a1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" other />
    </main>
    <Toaster />
  </QueryClientProvider>,
);
