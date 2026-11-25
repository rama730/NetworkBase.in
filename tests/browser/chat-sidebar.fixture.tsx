import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatSections } from '@/components/messages/ChatSections';
import { useChatUi } from '@/components/messages/chat-ui-store';
import { MessagesSidebar, SidebarSheetToggle } from '@/components/messages/MessagesSidebar';

// Lets the spec see the store: did Jump to… open the switcher?
function Probe() {
    const open = useChatUi((s) => s.switcherOpen);
    return <output data-testid="switcher-open">{String(open)}</output>;
}

// Board/review report §7: the Messages sidebar with an organization, its team workspace and an unrelated workspace.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
// ?sheet: the Messages layout's parts with a drawer open (1024–1279px: the sidebar steps aside, a sheet brings it back).
const sheet = (
    <div data-messages-surface className="nbm relative flex" style={{ height: 800 }}>
        <MessagesSidebar />
        <div className="min-w-0 flex-1"><header><SidebarSheetToggle /></header></div>
        <aside data-chat-pane="drawer" style={{ width: 340 }}>Thread</aside>
    </div>
);
createRoot(document.getElementById('root')!).render(
    new URLSearchParams(location.search).has('sheet') ? <QueryClientProvider client={client}>{sheet}</QueryClientProvider> :
    <QueryClientProvider client={client}><div className="nbm"><nav className="nb-chat-sidebar" style={{ width: 268 }}><ChatSections variant="sidebar" /></nav><Probe /></div></QueryClientProvider>,
);
