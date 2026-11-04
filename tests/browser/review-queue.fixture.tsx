import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReviewQueue } from '@/components/organizations/AssignmentsPanel';
import { Toaster } from '@/components/ui/sonner';
import TaskFilters from '@/components/workspaces/v2/tasks/TaskFilters';

// Mockup task 2 (Review artboard): the queue on its own, against the real component and stylesheet.
const zero = { open: 0, total: 0, needsYou: 0 };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
    // The tab panel as WorkspaceLayout draws it for Tasks: padded, except while the review queue fills it.
    <QueryClientProvider client={client}><section data-testid="tab-panel" className="w-full p-4 sm:p-5 has-[[data-review-full]]:p-0"><ReviewQueue orgId="org" onChanged={() => undefined} onClose={() => { document.title = 'closed'; }}
        tabs={new URLSearchParams(location.search).has('tabs') ? (waiting) => <TaskFilters scope="review" organization counts={{ all: zero, sprint: zero, backlog: zero, assignments: zero, mine: { open: 2, total: 2, needsYou: 1 }, review: { open: waiting, total: waiting, needsYou: waiting } }} /> : undefined} /></section><Toaster /></QueryClientProvider>,
);
