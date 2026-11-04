import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrgFilesCollection } from '@/components/organizations/OrgFilesPanel';

// Files report §1–§2: Submissions, Sprint materials and a team's Final files on their own, per ?view=.
const params = new URLSearchParams(location.search);
const view = (params.get('view') ?? 'submissions') as 'submissions' | 'materials';
const child = params.has('child');
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <OrgFilesCollection view={view} projectId={child ? 'falcon' : 'org'} org={{ mode: child ? 'child' : 'org', orgId: 'org', title: 'CSE 3B', slug: 'cse-3b', isAdmin: !params.has('member'), canCopy: false }} />
    </div>
  </QueryClientProvider>,
);
