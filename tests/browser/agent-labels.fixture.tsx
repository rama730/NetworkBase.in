import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentSettings } from '@/components/workspaces/settings/AgentSettings';
import { ViaLabel } from '@/components/ui/via-label';

// Report Part B: the muted label and the owner's "Show when agents helped" setting. ?case=owner|admin|org.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}>
        <main style={{ padding: 16, maxWidth: 720 }}>
            <ul aria-label="Labels" className="space-y-1 text-sm">
                <li>Ram <ViaLabel via="agent" agentName="Claude Code" /></li>
                <li>Ram <ViaLabel via="cli" /></li>
                <li>Ram <ViaLabel via={null} /></li>
            </ul>
            <AgentSettings projectId="11111111-1111-4111-8111-111111111111" />
        </main>
    </QueryClientProvider>,
);
