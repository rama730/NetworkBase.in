import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FilesTabRoleContext } from '@/components/workspaces/v2/files-tab/FilesTabRoleContext';
import { FilesViews } from '@/components/workspaces/v2/files-tab/FilesViews';
import { BranchesCollection } from '@/components/workspaces/v2/files-tab/BranchesCollection';

// Report H2 (M8, phase H-2): branches in the Files tab. Server actions answer from window.__actions (app-bundle.ts).
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <FilesTabRoleContext.Provider value={{ role: 'Role_Owner', canEdit: true, canManageFiles: true, canReadTasks: true }}>
      <FilesViews projectId="p1" canReadTasks canOpenGitHub={false} githubAccessResolved>
        <main style={{ height: '100vh' }}><BranchesCollection projectId="p1" /></main>
      </FilesViews>
    </FilesTabRoleContext.Provider>
  </QueryClientProvider>,
);
