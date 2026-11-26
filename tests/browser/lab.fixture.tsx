import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { LabAboutSections, LabHomeCard, LabPeople, LabSettingsCard, MyAlumniCard } from '@/components/organizations/Lab';

// Plan B6.1a (report 35.2): a lab's People, home card and Settings → Lab.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const view = new URLSearchParams(window.location.search).get('view');
const orgId = '7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }}>
      {view === 'about' ? <LabAboutSections orgId={orgId} /> : view === 'alumni-card' ? <MyAlumniCard orgId={orgId} /> : view === 'settings' ? <LabSettingsCard orgId={orgId} /> : view === 'home' ? <LabHomeCard orgId={orgId} slug="vision-lab" /> : <LabPeople orgId={orgId} roster={null} />}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
