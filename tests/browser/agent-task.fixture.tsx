import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentNotes } from '@/components/workspaces/v2/tasks/TaskDetailTabs/AgentNotes';
import { AgentPresence } from '@/components/workspaces/v2/tasks/TaskDetailTabs/AgentPresence';

// Report D5, D16 (M4c): "Claude Code and Codex are working on this" and the task's Agent notes.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}>
        <main style={{ padding: 16, maxWidth: 720 }} className="space-y-4">
            <AgentPresence projectId="11111111-1111-4111-8111-111111111111" taskId="22222222-2222-4222-8222-222222222222" />
            <AgentNotes projectId="11111111-1111-4111-8111-111111111111" taskId="22222222-2222-4222-8222-222222222222" />
        </main>
    </QueryClientProvider>,
);
