import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkspaceLastUpdate } from '@/components/workspaces/WorkspaceLastUpdate';

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];

createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={new QueryClient()}>
        <main style={{ padding: 16, width: 320 }}>
            {ids.map((id) => <p key={id}><WorkspaceLastUpdate projectId={id} className="block text-[13px] text-muted-foreground" /></p>)}
            <p data-row="time"><WorkspaceLastUpdate projectId={ids[0]} timeOnly /></p>
            <p data-row="slug"><WorkspaceLastUpdate projectId="not-a-uuid" /></p>
        </main>
    </QueryClientProvider>,
);
