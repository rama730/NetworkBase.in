import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReviewQueue } from '@/components/organizations/AssignmentsPanel';
import { Toaster } from '@/components/ui/sonner';
import TaskFilters from '@/components/workspaces/v2/tasks/TaskFilters';

// Mockup task 2 (Review artboard): the queue on its own, against the real component and stylesheet.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}><ReviewQueue orgId="org" onChanged={() => undefined} onClose={() => { document.title = 'closed'; }}
        tabs={new URLSearchParams(location.search).has('tabs') ? (waiting) => <TaskFilters scope="review" organization counts={{ review: waiting }} /> : undefined} /><Toaster /></QueryClientProvider>,
);
