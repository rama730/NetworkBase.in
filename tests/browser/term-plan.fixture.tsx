import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { TermCalendar, TermPlanSettings, TermPlanView } from '@/components/organizations/TermPlan';

// Report 30.3 W2 (plan B1.2a): the Term plan and Settings → Term plan.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view') ?? 'plan';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const O = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 1000, margin: '24px auto', padding: '0 16px' }}>{view === 'settings' ? <TermPlanSettings orgId={O} /> : view === 'calendar' ? <TermCalendar orgId={O} /> : <TermPlanView orgId={O} />}</main>
    <Toaster />
  </QueryClientProvider>,
);
