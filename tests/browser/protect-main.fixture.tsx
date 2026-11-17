import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FilesHistorySettings } from '@/components/workspaces/settings/BranchesSettings';

// Report H5 (M8, phase H-4): Settings → Files → History, then Protect main. Server actions answer from window.__actions.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="space-y-8" style={{ maxWidth: 760, padding: 24 }}><FilesHistorySettings projectId="p1" /></main>
  </QueryClientProvider>,
);
