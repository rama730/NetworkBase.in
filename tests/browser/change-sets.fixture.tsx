import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FilesTabRoleContext } from '@/components/workspaces/v2/files-tab/FilesTabRoleContext';
import { FilesViews } from '@/components/workspaces/v2/files-tab/FilesViews';
import { ChangesCollection } from '@/components/workspaces/v2/files-tab/ChangesCollection';
import { ChangeSetsReadyLink } from '@/components/workspaces/ChangeSetsReadyLink';

// Report G12 (M5): the Changes view in the Files tab. Server actions answer from window.__actions (app-bundle.ts).
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <FilesTabRoleContext.Provider value={{ role: 'Role_Owner', canEdit: true, canManageFiles: true, canReadTasks: true }}>
      <FilesViews projectId="p1" canReadTasks canOpenGitHub={false} githubAccessResolved>
        <header aria-label="Workspace header" style={{ padding: 8 }}><ChangeSetsReadyLink projectId="p1" slug="ponytail" /></header>
        <main style={{ height: '100vh' }}><ChangesCollection projectId="p1" /></main>
      </FilesViews>
    </FilesTabRoleContext.Provider>
  </QueryClientProvider>,
);
