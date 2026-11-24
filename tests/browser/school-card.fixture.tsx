import { createRoot } from 'react-dom/client';

import { Toaster } from '@/components/ui/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OrgSchoolCard } from '@/components/organizations/OrgSchoolCard';
import { SchoolAttentionCard, SchoolClassesTab } from '@/components/organizations/SchoolParts';

// Report 29.2 (plan B0.1): Settings → School for a class, Classes for a school.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view');
const isSchool = view === 'school';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const O = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 760, margin: '24px auto', padding: '0 16px' }}>
    <QueryClientProvider client={client}>
      {view === 'classes' ? <SchoolClassesTab orgId={O} /> : view === 'attention' ? <SchoolAttentionCard orgId={O} /> : <OrgSchoolCard orgId={O} isSchool={isSchool} />}
    </QueryClientProvider>
    <Toaster />
  </main>,
);
