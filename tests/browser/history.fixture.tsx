import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FilesTabRoleContext } from '@/components/workspaces/v2/files-tab/FilesTabRoleContext';
import { FilesViews } from '@/components/workspaces/v2/files-tab/FilesViews';
import { HistoryCollection } from '@/components/workspaces/v2/files-tab/HistoryCollection';

// Report H3 (M8, phase H-1): History in the Files tab. Server actions answer from window.__actions (app-bundle.ts).
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const canEdit = !new URLSearchParams(window.location.search).has('viewer');
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <FilesTabRoleContext.Provider value={{ role: canEdit ? 'Role_Owner' : 'Role_Viewer', canEdit, canManageFiles: canEdit, canReadTasks: true }}>
      <FilesViews projectId="p1" canReadTasks canOpenGitHub={false} githubAccessResolved>
        <main style={{ height: '100vh' }}><HistoryCollection projectId="p1" /></main>
      </FilesViews>
    </FilesTabRoleContext.Provider>
  </QueryClientProvider>,
);
