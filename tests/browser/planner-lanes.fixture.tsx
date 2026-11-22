import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { PlannerBoardLanes } from '@/components/workspaces/v2/tasks/PlannerBoardLanes';
import { normalizeTaskSurfaceRecord } from '@/lib/workspaces/task-presentation';

// Report 38.5 W7 and W3.4 (plan A1.6): the board grouped by project.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: () => undefined };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const workflow = [{ id: 'c1', title: 'To do', status: 'todo' }, { id: 'c2', title: 'In progress', status: 'in_progress' }, { id: 'c3', title: 'Completed', status: 'done' }];
const task = (id: string, n: number, title: string, status: string, column: string, partOf?: { id: string; title: string }) =>
  normalizeTaskSurfaceRecord({ id, taskNumber: n, title, status, workflowColumnId: column, projectId: 'p', projectKey: 'WT', partOf, partOfId: partOf?.id, updatedAt: '2026-11-20T00:00:00.000Z' });
const tasks = [
  task('t1', 1, 'Write the copy', 'todo', 'c1', { id: 'p1', title: 'Website relaunch' }),
  task('t2', 2, 'Design the hero', 'in_progress', 'c2', { id: 'p1', title: 'Website relaunch' }),
  task('t3', 3, 'Fix the footer', 'todo', 'c1'),
  task('t4', 4, 'Update pricing', 'todo', 'c1'),
];
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="p-6">
      <PlannerBoardLanes projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" workflow={workflow} tasks={tasks} canEdit={!w.__readOnly} onOpenTask={(t) => { w.__opened = t.id; }} />
    </main>
    <Toaster />
  </QueryClientProvider>,
);
