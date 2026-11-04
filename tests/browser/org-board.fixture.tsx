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
const stages = (counts: Record<string, number>, extra: Record<string, unknown> = {}) => ({ counts: { not_started: 0, in_progress: 0, submitted: 0, returned: 0, done: 0, missing: 0, excused: 0, ...counts },
  total: Object.entries(counts).filter(([k]) => k !== 'excused').reduce((n, [, v]) => n + v, 0), reviewRequired: true, teams: false,
  names: { not_started: [], in_progress: [], submitted: [], returned: [], done: [], missing: [], excused: [] }, remind: { not_started: [], missing: [] }, ...extra });
// Board view dropdown §6a: the assignment card in every state.
const master = task({ kind: 'assignment', dueDate: new Date(Date.now() + 7 * 864e5).toISOString(), assignmentProgress: { draft: false, closed: false, done: 12, total: 40, toReview: 6, excused: 0 },
  assignmentStages: stages({ done: 12, submitted: 6, returned: 2, in_progress: 14, not_started: 3, missing: 3 }), audience: { mode: 'everyone', count: 40 } });
const cards = [
  task({ id: 'm-groups', taskNumber: 4, title: 'Hash table library', kind: 'assignment', assignmentProgress: { draft: false, closed: false, done: 0, total: 8, toReview: 0, excused: 0, teams: true },
    assignmentStages: stages({ in_progress: 5, not_started: 3 }, { teams: true }), audience: { mode: 'teams', count: 8 } }),
  task({ id: 'm-draft', taskNumber: 5, title: 'Lab 3: Stacks', kind: 'assignment', status: 'todo', assignmentProgress: { draft: true, closed: false, done: 0, total: 0, toReview: 0, excused: 0 }, audience: { mode: 'everyone', count: 40 } }),
  task({ id: 'm-sched', taskNumber: 6, title: 'Quiz 2', kind: 'assignment', status: 'todo', publishAt: '2026-11-12T03:30:00.000Z', assignmentProgress: { draft: true, closed: false, done: 0, total: 0, toReview: 0, excused: 0 }, audience: { mode: 'everyone', count: 40 } }),
  task({ id: 'm-done', taskNumber: 7, title: 'Lab 1: Arrays', kind: 'assignment', status: 'done', assignmentProgress: { draft: false, closed: false, done: 39, total: 39, toReview: 0, excused: 1 },
    assignmentStages: stages({ done: 39, excused: 1 }), audience: { mode: 'everyone', count: 40 } }),
  task({ id: 'm-none', taskNumber: 8, title: 'Lab 4: Trees', kind: 'assignment', status: 'todo', assignmentProgress: { draft: false, closed: false, done: 0, total: 0, toReview: 0, excused: 0 }, audience: { mode: 'everyone', count: 0 } }),
  task({ id: 'c-own', taskNumber: 21, title: 'Lab 2: Linked lists', assignmentId: 'm-other', assigneeId: 'me', assignee: { id: 'me', fullName: 'Ravi Kumar', avatarUrl: null }, dueDate: new Date(Date.now() + 9 * 864e5).toISOString(),
    copyStage: { state: 'returned', late: false, since: null, reason: 'fix the README', fixBy: '2026-11-13T10:00:00.000Z', version: 1, reviewRequired: true, handIn: null } }),
  task({ id: 't-plain', taskNumber: 2, title: 'Prepare the Lab 1 grading rubric', priority: 'high', assigneeId: 'me', assignee: { id: 'me', fullName: 'Ravi Kumar', avatarUrl: null } }),
];
const copy = task({ id: 'copy-1', taskNumber: 9, status: 'done', assignmentId: 'master-1', assigneeId: 'rama', assignee: { id: 'rama', fullName: 'Rama', username: 'rama', avatarUrl: null } });
// Board/review report §6: CO1 runs with Week 3–4 inside it; Week 5–6 is next.
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
const sprints = [
  { id: 'co1', name: 'CO1', status: 'active', startDate: day(-20), endDate: day(20), parentSprintId: null },
  { id: 'w34', name: 'Week 3–4', status: 'active', startDate: day(-3), endDate: day(10), parentSprintId: 'co1' },
  { id: 'w56', name: 'Week 5–6', status: 'planning', startDate: day(11), endDate: day(20), parentSprintId: 'co1' },
];
const inSprints = [task({ id: 't-now', taskNumber: 12, title: 'Stack drill', sprintId: 'w34' }), task({ id: 't-next', taskNumber: 13, title: 'Queue drill', sprintId: 'w56' })];
Object.assign(window, { boardTasks: [master, ...inSprints, ...cards] });
// Board view dropdown §3: the numbers the board reads (the test changes them to check the board re-reads).
Object.assign(window, { countCalls: 0, counts: { all: { open: 7, total: 10, needsYou: 0 }, sprint: { open: 1, total: 1, needsYou: 0 }, backlog: { open: 5, total: 7, needsYou: 0 },
  review: { open: 6, total: 6, needsYou: 6 }, assignments: { open: 5, total: 6, needsYou: 0 }, mine: { open: 2, total: 2, needsYou: 1 } } });
Object.assign(window, { openCopy: () => patchWorkspaceTaskCaches(client, 'org', copy as never) });

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TasksTab projectId="org" projectSlug="cse-3b" projectName="CSE 3B" currentUserId="me" isOwner canEditTasks canManageWorkflow orgId="org" initialTasks={[master, ...inSprints, ...cards]} members={[]} sprints={sprints} />
    </div>
  </QueryClientProvider>,
);
