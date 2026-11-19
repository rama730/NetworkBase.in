import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { ProjectsTable, ProjectWork } from '@/components/workspaces/v2/tasks/PlannerParts';
import { TaskStageControl } from '@/components/workspaces/v2/tasks/TaskStageControl';
import { normalizeTaskSurfaceRecord } from '@/lib/workspaces/task-presentation';

// Report 38.5 T1 W1, W3, W5 (plan A1.3): the Projects list, a project's Work tab and completing it.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: () => undefined };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const candidates = [normalizeTaskSurfaceRecord({ id: 'c', taskNumber: 9, title: 'Write the copy', projectId: 'p', projectKey: 'WT', status: 'todo' })];
function Page() {
  const [task, setTask] = useState({ id: 'p1', itemType: 'project', stage: 'in_progress', status: 'in_progress', sprintId: null as string | null });
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      {(['all', 'active'] as const).map((mode) => (
        <ProjectsTable key={mode} projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" mode={mode} canEdit={!w.__readOnly} canPlanSprints members={[{ id: 'u1', label: 'Asha' }, { id: 'u2', label: 'Dev' }]}
          onOpen={(id) => { w.__opened = id; }} onNew={() => { w.__new = true; }} />
      ))}
      <section aria-label="Project page">
        <TaskStageControl projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" task={task} canEdit canPlanSprints sprints={[]} onMoved={(m) => setTask((t) => ({ ...t, ...m }))} />
        <ProjectWork projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" project={{ id: 'p1', title: 'Website relaunch' }} canEdit candidates={candidates}
          onNewTask={() => { w.__newIn = 'p1'; }} onOpenTask={(id) => { w.__opened = id; }} />
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Page /><Toaster /></QueryClientProvider>);
