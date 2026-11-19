import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { TasksMatrix } from '@/components/workspaces/v2/tasks/TasksMatrix';
import { normalizeTaskSurfaceRecord } from '@/lib/workspaces/task-presentation';

// Report 11.7 and 38.5 W9 (plan A1.2): the Matrix over fixed tasks; the clock is fixed to 2026-11-20.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: () => undefined };
const d = (n: number) => `2026-11-${String(n).padStart(2, '0')}T00:00:00.000Z`;
const raw = [
  { id: 'a', taskNumber: 1, title: 'Fix sign-in bug', priority: 'high', dueDate: d(20), status: 'todo' },
  { id: 'b', taskNumber: 2, title: 'Pricing page', priority: 'urgent', dueDate: null, status: 'todo' },
  { id: 'c', taskNumber: 3, title: 'Book venue', priority: 'low', dueDate: d(19), status: 'todo' },
  { id: 'e', taskNumber: 5, title: 'Old logo ideas', priority: 'medium', dueDate: null, status: 'todo' },
  { id: 'f', taskNumber: 6, title: 'Shipped thing', priority: 'high', dueDate: d(20), status: 'done' },
];
const tasks = raw.map((t) => normalizeTaskSurfaceRecord({ ...t, projectId: 'p1', projectKey: 'WT' }));
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="mx-auto max-w-6xl p-6">
      <TasksMatrix projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" tasks={tasks} members={[{ id: '7a0c1c34-1c7b-4b56-9d55-5f1f1d7c2a10', label: 'Asha' }]} canEdit canPlanSprints hasMore={false}
        onOpenTask={(t) => { w.__opened = t.id; }} />
    </main>
    <Toaster />
  </QueryClientProvider>,
);
