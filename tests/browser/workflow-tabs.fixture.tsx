import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import WorkspaceLayout from '@/components/workspaces/dashboard/WorkspaceLayout';
import { AddWorkflowDialog } from '@/components/workspaces/workflows/AddWorkflowDialog';
import { useWorkspaceWorkflows } from '@/components/workspaces/workflows/useWorkspaceWorkflows';
import { workflowTabsFor } from '@/components/workspaces/workflows/workflow-icons';
import { catalogEntry } from '@/lib/workflows/catalog';

// Report 38.2 F1 S1–S3 (plan A0.2): the real tab row and Add workflow dialog. Workflow actions answer from
// window.__actions (app-bundle.ts). Bugs and Project planner stand in as built; their rounds aren't yet.
catalogEntry('bugs')!.built = true;
catalogEntry('project_planner')!.built = true;

const project = { id: 'w1', title: 'Northwind', slug: 'northwind', visibility: 'private', status: 'active', publicTabVisibility: null } as never;

function App() {
  const workflows = useWorkspaceWorkflows('w1', null);
  const { refresh } = workflows;
  useEffect(() => { void refresh(); }, [refresh]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('tasks');
  const tabs = useMemo(() => workflowTabsFor(workflows.added), [workflows.added]);
  return (
    <WorkspaceLayout
      project={project} isOwner={workflows.canManage} isOwnerOrMember canManageSettings={workflows.canManage}
      activeTab={tab} onTabChange={setTab} followersCount={0} viewCount={0} isFollowing={false} onFollow={() => undefined} followLoading={false}
      onShare={() => undefined} onInvite={() => undefined} members={[]} loadingMembers={false} showFollow={false} showStats={false}
      workflowTabs={tabs} onAddWorkflow={workflows.enabled && workflows.canManage ? () => setOpen(true) : undefined}
    >
      <p data-testid="tab-body">{tab}</p>
      <AddWorkflowDialog open={open} onOpenChange={setOpen} workspaceId="w1" added={workflows.added} canManage={workflows.canManage} onChanged={() => void refresh()} />
    </WorkspaceLayout>
  );
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><App /><Toaster /></QueryClientProvider>);
