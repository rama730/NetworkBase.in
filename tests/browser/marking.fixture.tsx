import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { MarkingPanel, MarkingSettingsCard, MyMarkCard } from '@/components/organizations/Marking';

// Report 30.8 W7 (plan B1.5a): the Marking panel, the student's mark and Settings → Marking.
const view = new URLSearchParams(window.location.search).get('view') ?? 'panel';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const C = '6a1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 720, margin: '24px auto', padding: '0 16px' }}>
      {view === 'mine' ? <MyMarkCard copyId={C} /> : view === 'settings' ? <MarkingSettingsCard orgId={C} /> : <MarkingPanel copyId={C} />}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
