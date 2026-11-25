import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { AskTeamCard, CompanyRequestsSwitch } from '@/components/organizations/CompanyRequests';

// Plan B4.5 (report 33.6): Ask a team, My asks, and the team's switch.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view') ?? 'ask';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }}>
      {view === 'switch' ? <CompanyRequestsSwitch projectId="t1" /> : <AskTeamCard orgId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" base="/org/acme" />}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
