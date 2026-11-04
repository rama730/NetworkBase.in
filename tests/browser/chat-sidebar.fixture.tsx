import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatSections } from '@/components/messages/ChatSections';

// Board/review report §7: the Messages sidebar with an organization, its team workspace and an unrelated workspace.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}><nav style={{ width: 300, padding: 8 }}><ChatSections variant="sidebar" /></nav></QueryClientProvider>,
);
