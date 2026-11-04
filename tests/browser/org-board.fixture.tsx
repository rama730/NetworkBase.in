import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TasksTab from '@/components/workspaces/v2/TasksTab';
import { patchWorkspaceTaskCaches } from '@/lib/workspaces/task-cache';

// Board/review report §1: an organization's board as its admin sees it — one main card per assignment. The test
// sends a student's copy through the same cache write the task panel and the review queue use.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const now = new Date().toISOString();
const task = (over: Record<string, unknown>) => ({
  id: 'master-1', taskNumber: 1, title: 'Array lab', description: null, status: 'in_progress', priority: 'medium', storyPoints: null,
  dueDate: null, createdAt: now, updatedAt: now, position: 1, projectId: 'org', creatorId: 'me', assigneeId: null, sprintId: null,
  assignmentId: null, assignee: null, creator: null, sprint: null, ...over,
});
const master = task({ assignmentKind: 'assignment' });
const copy = task({ id: 'copy-1', taskNumber: 9, status: 'done', assignmentId: 'master-1', assigneeId: 'rama', assignee: { id: 'rama', fullName: 'Rama', username: 'rama', avatarUrl: null } });
// Board/review report §6: CO1 runs with Week 3–4 inside it; Week 5–6 is next.
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
const sprints = [
  { id: 'co1', name: 'CO1', status: 'active', startDate: day(-20), endDate: day(20), parentSprintId: null },
  { id: 'w34', name: 'Week 3–4', status: 'active', startDate: day(-3), endDate: day(10), parentSprintId: 'co1' },
  { id: 'w56', name: 'Week 5–6', status: 'planning', startDate: day(11), endDate: day(20), parentSprintId: 'co1' },
];
const inSprints = [task({ id: 't-now', taskNumber: 2, title: 'Stack drill', sprintId: 'w34' }), task({ id: 't-next', taskNumber: 3, title: 'Queue drill', sprintId: 'w56' })];
Object.assign(window, { boardTasks: [master, ...inSprints] });
Object.assign(window, { openCopy: () => patchWorkspaceTaskCaches(client, 'org', copy as never) });

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TasksTab projectId="org" projectSlug="cse-3b" projectName="CSE 3B" currentUserId="me" isOwner canEditTasks canManageWorkflow orgId="org" initialTasks={[master, ...inSprints]} members={[]} sprints={sprints} />
    </div>
  </QueryClientProvider>,
);
