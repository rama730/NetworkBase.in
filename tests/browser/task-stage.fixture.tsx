import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { TaskStageControl } from '@/components/workspaces/v2/tasks/TaskStageControl';

// Report 38.2 F1 S4, S7, W4 (plan A0.10): Shows in, the Stage menu and the Join-board sheet on a bug's page.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: () => undefined };
const q = new URLSearchParams(location.search);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Page() {
  const [task, setTask] = useState({ id: '7a0c1c34-1c7b-4b56-9d55-5f1f1d7c2a10', itemType: 'bug', stage: q.get('stage') ?? 'confirmed', status: q.get('status') ?? 'todo', sprintId: null as string | null });
  return (
    <main className="mx-auto max-w-xl p-6">
      <TaskStageControl projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" task={task} canEdit canPlanSprints={q.get('plan') !== '0'}
        sprints={q.get('running') === '0' ? [] : [{ id: '9b2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e50', name: 'Week 47', status: 'active' }]}
        onMoved={(m) => setTask((t) => ({ ...t, ...m }))} />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Page /><Toaster /></QueryClientProvider>);
