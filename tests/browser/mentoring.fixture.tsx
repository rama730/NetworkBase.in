import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { CheckinsPanel, MentoringCard, MentoringSettingsCard, MentorsView } from '@/components/organizations/Mentoring';

// Plan B2.3a (report 31.5): Members → Mentors, My mentor / My mentees, a pair's check-ins, Settings → Mentoring.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view') ?? 'mentors';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const O = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 1000, margin: '24px auto', padding: '0 16px' }}>
      {view === 'card' ? <MentoringCard orgId={O} /> : view === 'checkins' ? <CheckinsPanel orgId={O} learnerId={null} /> : view === 'settings' ? <MentoringSettingsCard orgId={O} /> : <MentorsView orgId={O} />}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
