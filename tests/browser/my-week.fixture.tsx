import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { MyWorkWeek } from '@/components/my-work/MyWorkWeek';

// Report 30.4 W3 (plan B1.7a): the Week view in My work.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 420, margin: '24px auto' }}><MyWorkWeek keepOpen /></main>
    <Toaster />
  </QueryClientProvider>,
);
