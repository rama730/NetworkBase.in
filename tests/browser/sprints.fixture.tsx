import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SprintPlanning from '@/components/workspaces/tabs/SprintPlanning';
import { Toaster } from '@/components/ui/sonner';

// Sprint redesign: a normal workspace's Sprints tab against the real components and stylesheet. The sprint detail
// comes from the mocked hook (see sprints.spec.ts); ?sprint= picks running, upcoming or ended.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}>
        <main style={{ padding: 16 }}>
            <SprintPlanning projectId="w1" projectSlug="search-app" projectKey="SRCH" isOwner isOwnerOrMember />
        </main>
        <Toaster />
    </QueryClientProvider>,
);
