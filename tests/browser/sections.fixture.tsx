import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { SectionSettingsCard, SectionsView, YourSectionCard } from '@/components/organizations/Sections';

// Report 30.9 W8 (plan B1.3a): the Sections view, Your section and Settings → Sections.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view') ?? 'sections';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const O = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 1100, margin: '24px auto', padding: '0 16px' }}>
      {view === 'mine' ? <YourSectionCard orgId={O} /> : view === 'settings' ? <SectionSettingsCard orgId={O} /> : <SectionsView orgId={O} />}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
