import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import CreateTaskModal from '@/components/workspaces/v2/tasks/CreateTaskModal';

// Report 38.4 F3 S2, W1–W3, W8, W10 (plan A0.8): the New module with type tabs, Starts at and the footer line.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: () => undefined };
const q = new URLSearchParams(location.search);
w.__created = [];
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <CreateTaskModal isOpen projectId="w1" onClose={() => { w.__closed = true; }} canAssignSprint={q.get('plan') !== '0'}
      types={['bug', 'request']} initialType={q.get('type') ?? undefined} openedFrom={(q.get('from') as 'tasks' | 'own') ?? 'tasks'} lockType={q.get('lock') === '1'}
      initialTitle={q.get('title') ?? undefined} initialSteps={q.get('steps') ?? undefined}
      onCreate={async (task: any) => {
        w.__created.push(task.draft);
        if (q.get('removed') === '1' && task.draft.itemType) return { success: false, error: 'Bugs was removed from this workspace', code: 'type_removed' };
        return { success: true };
      }}
      members={[{ id: '7a0c1c34-1c7b-4b56-9d55-5f1f1d7c2a10', fullName: 'Mei' }]} sprints={[{ id: '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', name: 'Sprint 4', status: 'active' }]} />
  </QueryClientProvider>,
);
