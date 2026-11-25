import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { OnboardingBoard, OnboardingPlanSettings, StartHere } from '@/components/organizations/CompanyOnboarding';

// Plan B4.4 (report 33.5): Start here, the Onboarding board, Settings → Onboarding plan.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view') ?? 'start';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const O = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 1000, margin: '24px auto', padding: '0 16px' }}>
      {view === 'board' ? <OnboardingBoard orgId={O} /> : view === 'plan' ? <OnboardingPlanSettings orgId={O} /> : <StartHere orgId={O} />}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
