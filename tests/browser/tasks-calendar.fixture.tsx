import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { TasksCalendar } from '@/components/workspaces/v2/tasks/TasksCalendar';
import { EMPTY_FILTERS } from '@/lib/workspaces/task-filters';

// Report 38.5 T1 W8, W10, S10 (plan A1.1): the Calendar view over mocked items (window.__actions).
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: () => undefined };
const q = new URLSearchParams(location.search);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="mx-auto max-w-6xl p-6">
      <TasksCalendar projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" scope="all" filters={q.get('mine') ? { ...EMPTY_FILTERS, assignee: ['me'] } : EMPTY_FILTERS}
        viewerId="u1" canEdit onOpenTask={(i) => { w.__opened = i.id; }} onNewOnDay={(d) => { w.__newOn = d; }} />
    </main>
    <Toaster />
  </QueryClientProvider>,
);
