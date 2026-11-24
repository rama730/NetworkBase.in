import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { ClassDetailsRail, ClassDetailsSettings, ClassNextLine, SyllabusAndTerm } from '@/components/organizations/ClassHomeParts';

// Report 30.2 W1 (plan B1.1): Class details, Syllabus, This term, Next class and Settings → Class details.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view') ?? 'about';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const O = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 960, margin: '24px auto', padding: '0 16px' }}>
      {view === 'about' ? <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'minmax(0,1fr) 320px' }}><div><SyllabusAndTerm orgId={O} base="/org/cs-301" /></div><aside><ClassDetailsRail orgId={O} settingsHref="/org/cs-301?tab=settings" /></aside></div> : null}
      {view === 'overview' ? <ClassNextLine orgId={O} /> : null}
      {view === 'settings' ? <ClassDetailsSettings orgId={O} /> : null}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
