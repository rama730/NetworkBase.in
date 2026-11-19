import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';

import { FilterChipRow, type FilterChip } from '@/components/ui/FilterChipRow';
import { EMPTY_FILTERS, filtersFromUrl, filtersToUrl, matchesFilters, type DueFilter, type TaskFilters } from '@/lib/workspaces/task-filters';

// Report 38.4 F3 S5, W7, W9 (plan A0.11): the shared filter chip row over a few tasks; the address keeps the filters.
const ME = '7a0c1c34-1c7b-4b56-9d55-5f1f1d7c2a10';
const ASHA = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
const today = new Date().toISOString();
const tasks = [
  { id: '1', title: 'Fix login', assigneeId: ME, itemType: 'bug', priority: 'high', dueDate: today, status: 'todo', sprintId: null },
  { id: '2', title: 'Write docs', assigneeId: ASHA, itemType: undefined, priority: 'medium', dueDate: null, status: 'todo', sprintId: null },
  { id: '3', title: 'Pick a venue', assigneeId: null, itemType: undefined, priority: 'low', dueDate: null, status: 'todo', sprintId: null },
];
function Page() {
  const [f, setF] = useState<TaskFilters>(() => filtersFromUrl(new URLSearchParams(location.search)));
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(filtersToUrl(f))) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    history.replaceState(null, '', `?${p.toString()}`);
  }, [f]);
  const chips: FilterChip[] = [
    { key: 'assignee', name: 'Assigned to', multi: true, selected: f.assignee, onChange: (assignee) => setF((x) => ({ ...x, assignee })), options: [{ value: 'me', label: 'Me' }, { value: ASHA, label: 'Asha' }, { value: 'none', label: 'Unassigned' }] },
    { key: 'type', name: 'Type', multi: true, selected: f.type, onChange: (type) => setF((x) => ({ ...x, type })), options: [{ value: 'task', label: 'Task', count: 2 }, { value: 'bug', label: 'Bug', count: 1 }] },
    { key: 'due', name: 'Due', multi: false, selected: f.due ? [f.due] : [], onChange: (v) => setF((x) => ({ ...x, due: (v[0] as DueFilter) ?? null })), options: [{ value: 'overdue', label: 'Overdue' }, { value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'none', label: 'No date' }] },
    { key: 'priority', name: 'Priority', multi: true, extra: true, selected: f.priority, onChange: (priority) => setF((x) => ({ ...x, priority })), options: [{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }] },
  ];
  const shown = tasks.filter((t) => matchesFilters(t, f, ME));
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <FilterChipRow chips={chips} onClearAll={() => setF(EMPTY_FILTERS)} />
      <ul aria-label="Tasks">{shown.map((t) => <li key={t.id}>{t.title}</li>)}</ul>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Page />);
