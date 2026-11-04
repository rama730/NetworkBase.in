import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrgWorkspacesTab } from '@/components/organizations/OrgWorkspacesTab';
import { Toaster } from '@/components/ui/sonner';

// Organization → Workspaces (workspaces report): the real tab and Discover's real card, against mocked reads.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}>
        <main style={{ padding: 16 }}>
            <OrgWorkspacesTab orgId="org" orgSlug="cse-3b" />
        </main>
        <Toaster />
    </QueryClientProvider>,
);
