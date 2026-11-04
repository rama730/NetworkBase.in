import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HandInSection } from '@/components/organizations/HandInSection';

// Review UX phase 3: the member's Hand in card, one state per ?copy=, against the real component and stylesheet.
const copy = new URLSearchParams(location.search).get('copy') ?? 'open';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const opened: string[] = [];
createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}>
        <main style={{ padding: 16, maxWidth: 560 }}>
            <HandInSection copyId={copy} onOpenFiles={() => undefined} onSubmitted={() => undefined}
                onUploadFiles={async () => ({ success: true })} onRemoveFile={async () => ({ success: true })}
                onOpenConversation={(kind) => { opened.push(kind); document.getElementById('opened')!.textContent = opened.join(',') }} />
            <output id="opened" />
        </main>
    </QueryClientProvider>,
);
