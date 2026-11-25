import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { CompanyGoalsCard, CompanyProjects, ProjectGoalLine } from '@/components/organizations/CompanyGoals';

// Plan B4.3 (report 33.4): Goals and Timeline views, the Company goals card, the project header line.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view') ?? 'projects';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const O = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 1100, margin: '24px auto', padding: '0 16px' }} className="space-y-4">
      {view === 'line' ? <ProjectGoalLine projectId="p1" /> : view === 'card' ? <CompanyGoalsCard orgId={O} base="/org/acme" /> : <CompanyProjects orgId={O} base="/org/acme" list={<p>The list</p>} />}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
