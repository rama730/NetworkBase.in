import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { CommunityChallenges, CurrentChallengeCard } from '@/components/organizations/CommunityChallenges';

// Plan B5.4a (report 34.5): Tasks → Challenges and the current challenge on the Overview.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const O = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }} className="space-y-4">
      <CurrentChallengeCard orgId={O} base="/org/devs" />
      <CommunityChallenges orgId={O} base="/org/devs" />
    </main>
    <Toaster />
  </QueryClientProvider>,
);
