import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { MeetingHeader, NewMeetingDialog, OpenActionItems } from "@/components/workspaces/doc/DocMeeting";

// Report 38.11 D1 (plan A4.1): the meeting header, New meeting and Open action items.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view');
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const P = "5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="max-w-3xl p-6">
      {view === 'new' ? <NewMeetingDialog projectId={P} open onOpenChange={() => undefined} />
        : view === 'actions' ? <OpenActionItems projectId={P} projectSlug="acme" />
        : <MeetingHeader projectId={P} docSlug="weekly-jan-7" />}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
