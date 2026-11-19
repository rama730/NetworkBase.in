import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import CreateTaskModal from '@/components/workspaces/v2/tasks/CreateTaskModal';

// Report 38.4 calls 3–4, W4 (plan A0.7): owners and admins pick a sprint in New; members see "Goes to the Backlog".
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: () => undefined };
const canPlan = new URLSearchParams(location.search).get('plan') === '1';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <CreateTaskModal isOpen projectId="w1" onClose={() => undefined} canAssignSprint={canPlan}
      onCreate={async (task: any) => { w.__created = task.draft; return { success: true }; }}
      members={[{ id: '7a0c1c34-1c7b-4b56-9d55-5f1f1d7c2a10', fullName: 'Asha' }]} sprints={[{ id: '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', name: 'Sprint 4', status: 'active' }]} />
  </QueryClientProvider>,
);
