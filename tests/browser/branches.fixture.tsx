import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FilesTabRoleContext } from '@/components/workspaces/v2/files-tab/FilesTabRoleContext';
import { FilesViews, useFilesViews } from '@/components/workspaces/v2/files-tab/FilesViews';
import { BranchesCollection } from '@/components/workspaces/v2/files-tab/BranchesCollection';
import { BranchExplorer, BranchPicker, BranchTree } from '@/components/workspaces/v2/files-tab/BranchExplorer';
import { HistoryCollection } from '@/components/workspaces/v2/files-tab/HistoryCollection';

// Report H2 (M8, H-2b): branches like GitHub. The picker in the header switches All files (and its sidebar tree) to
// the branch. Server actions answer from window.__actions (app-bundle.ts).
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Shell() {
  const v = useFilesViews()!;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 8 }}>
        <button type="button" onClick={() => v.selectView('history')}>History</button>
        <button type="button" onClick={() => v.selectView('project')}>All files</button>
        <BranchPicker projectId="p1" />
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {v.branch && v.view === 'project' ? <aside aria-label="Sidebar" className="hidden w-[220px] shrink-0 md:block"><BranchTree projectId="p1" /></aside> : null}
        <main style={{ flex: 1, minWidth: 0 }}>
          {v.view === 'branches' ? <BranchesCollection projectId="p1" /> : v.view === 'history' ? <HistoryCollection projectId="p1" /> : v.branch ? <BranchExplorer projectId="p1" /> : <p>Main’s files</p>}
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <FilesTabRoleContext.Provider value={{ role: 'Role_Owner', canEdit: true, canManageFiles: true, canReadTasks: true }}>
      <FilesViews projectId="p1" canReadTasks canOpenGitHub={false} githubAccessResolved>
        <Shell />
      </FilesViews>
    </FilesTabRoleContext.Provider>
  </QueryClientProvider>,
);
