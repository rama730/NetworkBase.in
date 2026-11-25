import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { CompanyAboutSections, CompanySettingsCard, CompanyWideToggle, FromTeamsPages, NeedsReviewCard, WhatsNewCard } from '@/components/organizations/CompanyParts';

// Plan B4.1c (report 33.2 calls 5, 7): Values, Offices, Our teams; Settings → Company.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view') ?? 'about';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const O = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }} className="space-y-6">
      {view === 'settings' ? <CompanySettingsCard orgId={O} /> : view === 'teams' ? <><FromTeamsPages orgId={O} /><CompanyWideToggle projectId="t1" docSlug="shipping" on={false} /></> : view === 'overview' ? <><WhatsNewCard orgId={O} base="/org/acme" /><NeedsReviewCard orgId={O} base="/org/acme" /></> : <CompanyAboutSections orgId={O} />}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
